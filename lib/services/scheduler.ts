import cron from "node-cron";
import { Site } from "@prisma/client";
import { addDays, addHours, nextSunday } from "date-fns";
import { CronExpressionParser } from "cron-parser";

import { prisma } from "@/lib/prisma";
import { runBackup } from "@/lib/services/backup";
import { getAppSettings } from "@/lib/services/settings";
import { logActivity } from "@/lib/services/logging";

let started = false;

function frequencyToCron(site: Site) {
  if (site.backupFrequency === "hourly") {
    return "0 * * * *";
  }
  if (site.backupFrequency === "daily") {
    const [hour, minute] = (site.backupTime ?? "02:00").split(":");
    return `${minute} ${hour} * * *`;
  }
  if (site.backupFrequency === "weekly") {
    const [hour, minute] = (site.backupTime ?? "03:00").split(":");
    return `${minute} ${hour} * * 0`;
  }
  if (site.backupFrequency === "cron" && site.cronExpression) {
    return site.cronExpression;
  }
  return null;
}

export function getNextRunForSite(site: Site) {
  try {
    const cronExpression = frequencyToCron(site);
    if (!cronExpression || !site.scheduleEnabled || !site.active) {
      return null;
    }
    return CronExpressionParser.parse(cronExpression).next().toDate();
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

async function tick() {
  const settings = await getAppSettings();
  if (!settings.schedulerEnabled) {
    return;
  }

  const sites = await prisma.site.findMany({
    where: {
      active: true,
      scheduleEnabled: true
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
        expression
      });
      continue;
    }

    const now = new Date();
    let candidate: Date;

    try {
      candidate = CronExpressionParser.parse(expression, {
        currentDate: new Date(now.getTime() - 60000)
      }).next().toDate();
    } catch {
      await logActivity("scheduler", `Unable to calculate next run for ${site.name}`, "error", {
        siteId: site.id,
        expression
      });
      continue;
    }

    const ageMs = Math.abs(candidate.getTime() - now.getTime());

    if (ageMs < 60000) {
      try {
        await runBackup(site.id, "schedule");
      } catch (error) {
        await logActivity("scheduler", `Scheduled backup failed for ${site.name}`, "error", {
          siteId: site.id,
          error: error instanceof Error ? error.message : "Unknown error"
        });
      }
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
