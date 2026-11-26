import { ExternalLink, Globe2, Phone, Plus } from "lucide-react";

import { safeExternalUrl } from "@/lib/domain/normalise";
import { normaliseDialNumber } from "@/lib/domain/phone";
import type { CompanySummary, ContactSummary } from "@/lib/domain/types";

export type CompanyContactField = "phone" | "website";

export function CompanyContactLinks({ company, contact, onEditDetails, showPhone = true }: {
  company: CompanySummary;
  contact?: ContactSummary;
  onEditDetails?: (field: CompanyContactField) => void;
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
      : onEditDetails && <button type="button" onClick={() => onEditDetails("phone")}><Plus size={14} aria-hidden="true" />Add company phone</button>)}
    {showPhone && !company.doNotContact && !company.archivedAt && !contact?.doNotContact && direct && direct !== dial
      && <a href={`tel:${direct}`}><Phone size={14} aria-hidden="true" />{contact?.name} · {contact?.phone}</a>}
    {companyLinkedin && <a href={companyLinkedin} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} aria-hidden="true" />Company LinkedIn</a>}
    {contactLinkedin && <a href={contactLinkedin} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} aria-hidden="true" />Contact LinkedIn · {contact?.name}</a>}
    {website ? <a href={website} target="_blank" rel="noopener noreferrer"><Globe2 size={14} aria-hidden="true" />Website</a>
      : onEditDetails && !company.archivedAt && <button type="button" onClick={() => onEditDetails("website")}><Globe2 size={14} aria-hidden="true" />Add website</button>}
  </div>;
}
