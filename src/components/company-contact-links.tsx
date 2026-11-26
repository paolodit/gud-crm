import { ExternalLink, Globe2, Phone, Plus } from "lucide-react";

import { safeExternalUrl } from "@/lib/domain/normalise";
import { normaliseDialNumber } from "@/lib/domain/phone";
import type { CompanySummary, ContactSummary } from "@/lib/domain/types";

export function CompanyContactLinks({ company, contact, onAddPhone, showPhone = true }: {
  company: CompanySummary;
  contact?: ContactSummary;
  onAddPhone?: () => void;
  showPhone?: boolean;
}) {
  const dial = normaliseDialNumber(company.switchboardPhone);
  const direct = normaliseDialNumber(contact?.phone);
  const website = safeExternalUrl(company.websiteUrl);
  const companyLinkedin = safeExternalUrl(company.linkedinUrl);
  const contactLinkedin = safeExternalUrl(contact?.linkedinUrl);
  return <div className="company-contact-links">
    {showPhone && !company.doNotContact && !company.archivedAt && (dial
      ? <a href={`tel:${dial}`}><Phone size={14} aria-hidden="true" />Head office · {company.switchboardPhone}</a>
      : onAddPhone && <button type="button" onClick={onAddPhone}><Plus size={14} aria-hidden="true" />Add company phone</button>)}
    {showPhone && !company.doNotContact && !company.archivedAt && !contact?.doNotContact && direct && direct !== dial
      && <a href={`tel:${direct}`}><Phone size={14} aria-hidden="true" />{contact?.name} · {contact?.phone}</a>}
    {companyLinkedin && <a href={companyLinkedin} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} aria-hidden="true" />Company LinkedIn</a>}
    {contactLinkedin && <a href={contactLinkedin} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} aria-hidden="true" />Contact LinkedIn · {contact?.name}</a>}
    {website && <a href={website} target="_blank" rel="noopener noreferrer"><Globe2 size={14} aria-hidden="true" />Website</a>}
  </div>;
}
