export function normalizeSiteUrl(siteUrl?: string | null) {
  const trimmed = siteUrl?.trim();
  if (!trimmed) {
    return null;
  }

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return withProtocol.replace(/\/+$/, "");
}

export function getWpAdminUrl(siteUrl?: string | null) {
  const normalized = normalizeSiteUrl(siteUrl);
  return normalized ? `${normalized}/wp-admin` : null;
}
