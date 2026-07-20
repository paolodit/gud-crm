import Image from "next/image";

export function BrandLogo({ size = 42, priority = false }: { size?: number; priority?: boolean }) {
  return (
    <Image
      className="gud-logo"
      src="/gud-crm-logo.png"
      alt="GUD CRM"
      width={size}
      height={size}
      priority={priority}
    />
  );
}
