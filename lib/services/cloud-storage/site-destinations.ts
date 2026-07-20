import { z } from "zod";

import { prisma } from "@/lib/prisma";
import type { SanitizedCloudConnection } from "./connections-types";

export const siteCloudDestinationSchema = z.object({
  cloudConnectionId: z.string().min(1),
  enabled: z.boolean().default(true),
  uploadScheduledBackups: z.boolean().default(true),
  uploadManualBackups: z.boolean().default(true),
  retentionPolicy: z.enum(["delete_with_local", "retain_remote"]).default("retain_remote"),
  remoteFolderName: z.string().trim().max(180).nullable().optional()
});

export const siteCloudDestinationsSchema = z.array(siteCloudDestinationSchema)
  .max(20)
  .superRefine((values, context) => {
    const seen = new Set<string>();
    values.forEach((value, index) => {
      if (seen.has(value.cloudConnectionId)) {
        context.addIssue({
          code: "custom",
          path: [index, "cloudConnectionId"],
          message: "Each cloud account can only be selected once."
        });
      }
      seen.add(value.cloudConnectionId);
    });
  });

export type SiteCloudDestinationInput = z.infer<typeof siteCloudDestinationSchema>;

export interface SiteCloudDestinationRepository {
  listConnectionIds(siteId: string): Promise<string[]>;
  replace(siteId: string, inputs: readonly SiteCloudDestinationInput[]): Promise<void>;
}

export const prismaSiteCloudDestinationRepository: SiteCloudDestinationRepository = {
  async listConnectionIds(siteId) {
    const values = await prisma.siteCloudDestination.findMany({
      where: { siteId },
      select: { cloudConnectionId: true }
    });
    return values.map((value) => value.cloudConnectionId);
  },
  async replace(siteId, inputs) {
    const selectedIds = inputs.map((input) => input.cloudConnectionId);
    await prisma.$transaction([
      prisma.siteCloudDestination.deleteMany({
        where: { siteId, cloudConnectionId: { notIn: selectedIds } }
      }),
      ...inputs.map((input) => prisma.siteCloudDestination.upsert({
        where: { siteId_cloudConnectionId: { siteId, cloudConnectionId: input.cloudConnectionId } },
        create: {
          siteId,
          cloudConnectionId: input.cloudConnectionId,
          enabled: input.enabled,
          uploadScheduledBackups: input.uploadScheduledBackups,
          uploadManualBackups: input.uploadManualBackups,
          retentionPolicy: input.retentionPolicy,
          remoteFolderName: input.remoteFolderName || null
        },
        update: {
          enabled: input.enabled,
          uploadScheduledBackups: input.uploadScheduledBackups,
          uploadManualBackups: input.uploadManualBackups,
          retentionPolicy: input.retentionPolicy,
          remoteFolderName: input.remoteFolderName || null
        }
      }))
    ]);
  }
};

export function validateAuthorizedDestinations(
  inputs: readonly SiteCloudDestinationInput[],
  connections: readonly SanitizedCloudConnection[],
  existingConnectionIds: ReadonlySet<string> = new Set()
) {
  const byId = new Map(connections.map((connection) => [connection.id, connection]));
  for (const input of inputs) {
    const connection = byId.get(input.cloudConnectionId);
    if (!connection) {
      throw new Error("A selected cloud account is unavailable or you are not authorized to access it.");
    }
    const usable = connection.enabled && connection.status === "connected";
    if (!usable && !existingConnectionIds.has(connection.id)) {
      throw new Error(`${connection.displayName} is disabled or disconnected and cannot be selected.`);
    }
  }
  return inputs;
}

export async function saveSiteCloudDestinations(
  siteId: string,
  rawInputs: unknown,
  connections: readonly SanitizedCloudConnection[],
  repository: SiteCloudDestinationRepository = prismaSiteCloudDestinationRepository
) {
  const inputs = siteCloudDestinationsSchema.parse(rawInputs);
  const existingConnectionIds = await repository.listConnectionIds(siteId);
  validateAuthorizedDestinations(inputs, connections, new Set(existingConnectionIds));
  await repository.replace(siteId, inputs);
}

export function destinationAppliesToTrigger(
  destination: Pick<SiteCloudDestinationInput, "enabled" | "uploadScheduledBackups" | "uploadManualBackups">,
  triggerSource: string
) {
  if (!destination.enabled) return false;
  return triggerSource === "schedule"
    ? destination.uploadScheduledBackups
    : destination.uploadManualBackups;
}
