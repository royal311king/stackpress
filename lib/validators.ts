import { z } from "zod";

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
