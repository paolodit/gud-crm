"use client";

import Image from "next/image";
import { ExternalLink, Play, Search, Video } from "lucide-react";
import { useState } from "react";
import { useGudPage } from "./gud-page-controls";
import { videoGuides, type VideoGuide } from "@/lib/video-guides";

const topics = ["All videos", ...new Set(videoGuides.map((video) => video.topic))];

export function VideoLibrary() {
  const [topic, setTopic] = useState("All videos");
  const [query, setQuery] = useState("");
  const videos = videoGuides.filter((video) => (topic === "All videos" || video.topic === topic)
    && `${video.title} ${video.speaker} ${video.publisher} ${video.reason}`.toLowerCase().includes(query.trim().toLowerCase()));

  useGudPage("/playbook", { actions: ["search", "filter (topic)", "open (video ID)", "clear_filters"], topics, query, topic, videos: videos.map(({ id, title, speaker, topic, reason }) => ({ id, title, speaker, topic, reason })) }, request => {
    if (request.action === "search") setQuery(request.value ?? "");
    else if (request.action === "filter" && topics.includes(request.value ?? "")) setTopic(request.value!);
    else if (request.action === "clear_filters") { setQuery(""); setTopic("All videos"); }
    else if (request.action === "open") {
      const video = videoGuides.find(v => v.id === request.value);
      if (!video) throw new Error("Choose a video from the library.");
      const opened = window.open(`https://www.youtube.com/watch?v=${encodeURIComponent(video.id)}`, "_blank", "noopener,noreferrer");
      return { requested: true, message: "YouTube was requested in a new tab. If the browser blocks it, use the visible video link.", opened: Boolean(opened) };
    } else throw new Error("That video control is not available.");
    return { applied: true };
  });
  return <>
    <header className="page-header"><div className="page-title"><h1>Video guides</h1><p>A small, curated library for better sales conversations.</p></div></header>
    <div className="workspace-page video-library">
      <section className="video-library-intro"><span className="eyebrow">Worth your time</span><h2>Good ideas. From people who do the work.</h2><p>Start with the challenge in front of you: a client conversation, a price or a pitch. Each video comes with a reason to watch.</p></section>
      <section className="video-library-toolbar" aria-label="Filter video guides">
        <div className="video-topic-filters" role="group" aria-label="Video topics">{topics.map((item) => <button className="btn btn-quiet" type="button" key={item} aria-pressed={topic === item} onClick={() => setTopic(item)}>{item}</button>)}</div>
        <label className="video-library-search"><Search size={16} aria-hidden="true" /><input type="search" aria-label="Search video guides" placeholder="Search videos or speakers" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      </section>
      <p className="video-library-count" role="status">{videos.length} {videos.length === 1 ? "video" : "videos"} · Opens on YouTube in a new tab</p>
      <div className="video-library-grid">{videos.map((video) => <VideoCard key={video.id} video={video} />)}</div>
      {!videos.length ? <div className="surface video-library-empty"><Search size={24} /><h2>No matching videos</h2><p>Try a different topic, title or speaker.</p><button className="btn btn-quiet" onClick={() => { setQuery(""); setTopic("All videos"); }}>Clear filters</button></div> : null}
      <p className="video-library-note">Independent picks, not sponsored. Videos belong to their creators; availability and YouTube playback conditions may change.</p>
    </div>
  </>;
}

function VideoCard({ video }: { video: VideoGuide }) {
  const [imageFailed, setImageFailed] = useState(false);
  return <a className="video-guide-card surface" href={`https://www.youtube.com/watch?v=${video.id}`} target="_blank" rel="noopener noreferrer" aria-label={`Watch ${video.title} on YouTube (opens in a new tab)`}>
    <div className="video-guide-thumbnail">
      {imageFailed ? <Video size={40} aria-hidden="true" /> : <Image src={`https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`} alt="" fill sizes="(max-width: 640px) 100vw, (max-width: 1100px) 50vw, 400px" onError={() => setImageFailed(true)} />}
      <span className="video-guide-play"><Play size={22} fill="currentColor" aria-hidden="true" /></span>
    </div>
    <div className="video-guide-copy"><span className="eyebrow">{video.topic}</span><h2>{video.title}</h2><p className="video-guide-byline">{video.speaker} · {video.publisher}</p><p className="video-guide-reason">{video.reason}</p><span className="video-guide-watch">Watch on YouTube <ExternalLink size={14} aria-hidden="true" /></span></div>
  </a>;
}
