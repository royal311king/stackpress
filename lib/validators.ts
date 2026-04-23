import { z, ZodError } from "zod";

export const siteSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
  siteDirectory: z.string().min(1),
  backupDestination: z.string().min(1),
  dbContainerName: z.string().min(1),
  dbName: z.string().min(1),
  dbUser: z.string().min(1),
  dbPassword: z.string().min(1),
  wordpressContainerName: z.string().min(1),
  uploadsPath: z.string().min(1),
  active: z.boolean().default(true),
  notes: z.string().optional().nullable(),
  backupFrequency: z.string().default("manual"),
  backupTime: z.string().optional().nullable(),
  timezone: z.string().default("America/Chicago"),
  cronExpression: z.string().optional().nullable(),
  retentionCount: z.number().int().min(1).max(100).default(10),
  retentionDays: z.number().int().min(1).max(3650).optional().nullable(),
  neverDeleteNewest: z.boolean().default(true),
  backupMode: z.enum(["full", "database", "files"]).default("full"),
  scheduleEnabled: z.boolean().default(false)
});

export const settingsSchema = z.object({
  defaultTimezone: z.string().min(1),
  defaultBackupRoot: z.string().min(1),
  defaultLogRoot: z.string().min(1),
  schedulerEnabled: z.boolean().default(true),
  diskFreeThresholdGb: z.number().int().min(1).max(1000).default(2)
});

const siteFieldLabels: Record<string, string> = {
  name: "Site Name",
  slug: "Site Slug",
  siteDirectory: "Site Directory",
  backupDestination: "Backup Destination",
  dbContainerName: "DB Container",
  dbName: "DB Name",
  dbUser: "DB User",
  dbPassword: "DB Password",
  wordpressContainerName: "WordPress Container",
  uploadsPath: "Uploads Path",
  timezone: "Timezone",
  backupFrequency: "Backup Frequency",
  backupMode: "Backup Mode",
  retentionCount: "Retention Count"
};

function getIssueMessage(pathKey: string, code: string) {
  if (code === "too_small") {
    return `${siteFieldLabels[pathKey] ?? pathKey} is required.`;
  }

  return "Please review this field.";
}

export function formatSiteValidationError(error: ZodError) {
  const fieldErrors: Record<string, string> = {};

  for (const issue of error.issues) {
    const pathKey = String(issue.path[0] ?? "form");
    if (fieldErrors[pathKey]) {
      continue;
    }

    fieldErrors[pathKey] = issue.message && !issue.message.startsWith("[")
      ? issue.message
      : getIssueMessage(pathKey, issue.code);
  }

  const requiredFields = Object.entries(fieldErrors)
    .filter(([, message]) => message.endsWith("is required."))
    .map(([key]) => siteFieldLabels[key] ?? key);

  const summary = requiredFields.length > 0
    ? `Please fill out required fields: ${requiredFields.join(", ")}.`
    : "Please review the highlighted fields and try again.";

  return {
    summary,
    fieldErrors
  };
}
