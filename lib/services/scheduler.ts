import cron from "node-cron";
import { Site } from "@prisma/client";
import { addDays, addHours, nextSunday } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { CronExpressionParser } from "cron-parser";

import { prisma } from "@/lib/prisma";
import { runBackup } from "@/lib/services/backup";
import { logActivity } from "@/lib/services/logging";
import { getAppSettings } from "@/lib/services/settings";

let started = false;

function getScheduledTimeParts(site: Site, fallback: string) {
  return (site.backupTime ?? fallback).split(":");
}

function parseCronInTimezone(site: Site, currentDate?: Date) {
  const expression = frequencyToCron(site);
  if (!expression) {
    return null;
  }

  return CronExpressionParser.parse(expression, {
    currentDate,
    tz: site.timezone
  });
}

export function frequencyToCron(site: Site) {
  if (site.backupFrequency === "manual") {
    return null;
  }
  if (site.backupFrequency === "hourly") {
    return "0 * * * *";
  }
  if (site.backupFrequency === "daily") {
    const [hour, minute] = getScheduledTimeParts(site, "02:00");
    return `${minute} ${hour} * * *`;
  }
  if (site.backupFrequency === "weekly") {
    const [hour, minute] = getScheduledTimeParts(site, "03:00");
    return `${minute} ${hour} * * 0`;
  }
  if (site.backupFrequency === "cron" && site.cronExpression) {
    return site.cronExpression;
  }
  return null;
}

export function isScheduleActive(site: Site) {
  return site.active && site.scheduleEnabled && site.backupFrequency !== "manual";
}

export function getScheduleLabel(site: Site) {
  if (site.backupFrequency === "manual") {
    return "Manual only";
  }
  if (site.backupFrequency === "cron") {
    return site.cronExpression ? `Cron: ${site.cronExpression}` : "Cron: not configured";
  }
  return `${site.backupFrequency} at ${site.backupTime ?? "default time"}`;
}

export function getNextRunForSite(site: Site) {
  try {
    if (!isScheduleActive(site)) {
      return null;
    }

    return parseCronInTimezone(site)?.next().toDate() ?? null;
  } catch {
    if (site.backupFrequency === "hourly") {
      return addHours(new Date(), 1);
    }
    if (site.backupFrequency === "daily") {
      return addDays(new Date(), 1);
    }
    if (site.backupFrequency === "weekly") {
      return nextSunday(new Date());
    }
    return null;
  }
}

export function isValidSchedule(site: Site) {
  const expression = frequencyToCron(site);
  if (!expression) {
    return site.backupFrequency === "manual";
  }
  return cron.validate(expression);
}

export function formatScheduleTime(value: Date | null, timezone: string) {
  if (!value) {
    return "Not scheduled";
  }

  return `${formatInTimeZone(value, timezone, "yyyy-MM-dd HH:mm:ss zzz")} (${timezone})`;
}

async function tick() {
  const settings = await getAppSettings();
  if (!settings.schedulerEnabled) {
    return;
  }

  const sites = await prisma.site.findMany({
    where: {
      active: true,
      scheduleEnabled: true,
      NOT: { backupFrequency: "manual" }
    }
  });

  for (const site of sites) {
    const expression = frequencyToCron(site);
    if (!expression) {
      continue;
    }

    if (!cron.validate(expression)) {
      await logActivity("scheduler", `Invalid cron expression for ${site.name}`, "error", {
        siteId: site.id,
        expression,
        timezone: site.timezone
      });
      continue;
    }

    const now = new Date();
    let candidate: Date;

    try {
      candidate = parseCronInTimezone(site, new Date(now.getTime() - 60000))?.next().toDate() ?? now;
    } catch {
      await logActivity("scheduler", `Unable to calculate next run for ${site.name}`, "error", {
        siteId: site.id,
        expression,
        timezone: site.timezone
      });
      continue;
    }

    const ageMs = Math.abs(candidate.getTime() - now.getTime());
    if (ageMs >= 60000) {
      continue;
    }

    try {
      await logActivity("scheduler", `Scheduled backup triggered for ${site.name}`, "info", {
        siteId: site.id,
        expression,
        timezone: site.timezone,
        triggerAt: now.toISOString()
      });
      await runBackup(site.id, "schedule");
    } catch (error) {
      await logActivity("scheduler", `Scheduled backup failed for ${site.name}`, "error", {
        siteId: site.id,
        error: error instanceof Error ? error.message : "Unknown error",
        expression,
        timezone: site.timezone
      });
    }
  }
}

export async function startScheduler() {
  if (started) {
    return;
  }

  started = true;
  await tick();
  cron.schedule("* * * * *", () => {
    void tick();
  });
}
