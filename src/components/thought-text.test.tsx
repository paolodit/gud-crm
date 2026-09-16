import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ThoughtText } from "./thought-text";
describe("safe Thought formatting", () => {
  it("renders emphasis and safe external links", () => {
    const html = renderToStaticMarkup(<ThoughtText text="**Bold** *italic* [Website](https://example.com)" />);
    expect(html).toContain("<strong>Bold</strong>");
    expect(html).toContain("<em>italic</em>");
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('rel="noopener noreferrer"');
  });
  it("escapes HTML and never links dangerous protocols or nests links in note buttons", () => {
    const html = renderToStaticMarkup(<ThoughtText text={'<img src=x onerror=alert(1)> [bad](javascript:alert(1))'} />);
    expect(html).not.toContain("<img"); expect(html).not.toContain("<a");
    expect(renderToStaticMarkup(<ThoughtText text="[Website](https://example.com)" links={false} />)).not.toContain("<a");
  });
});
