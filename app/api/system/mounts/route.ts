import fs from "node:fs";
import { NextResponse } from "next/server";

function decodeMountValue(value: string) {
  return value.replace(/\\040/g, " ").replace(/\\011/g, "\t").replace(/\\012/g, "\n");
}

function isUsefulMount(containerPath: string, source: string) {
  if (["/", "/app"].includes(containerPath)) {
    return true;
  }

  return (
    containerPath.startsWith("/mnt") ||
    containerPath.startsWith("/Volumes") ||
    containerPath.startsWith("/Users") ||
    containerPath.startsWith("/app/data") ||
    containerPath.startsWith("/app/logs") ||
    containerPath.startsWith("/app/storage") ||
    containerPath === "/var/run/docker.sock" ||
    source.startsWith("/Users") ||
    source.startsWith("/Volumes")
  );
}

export async function GET() {
  if (!fs.existsSync("/proc/self/mountinfo")) {
    return NextResponse.json({ mounts: [], note: "Mount inspection is only available on Linux containers." });
  }

  const mounts = fs.readFileSync("/proc/self/mountinfo", "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [pre, post = ""] = line.split(" - ");
      const preFields = pre.split(" ");
      const postFields = post.split(" ");
      const containerPath = decodeMountValue(preFields[4] ?? "");
      const filesystem = postFields[0] ?? "";
      const source = decodeMountValue(postFields[1] ?? "");
      return { hostPath: source, containerPath, filesystem };
    })
    .filter((mount) => mount.containerPath && isUsefulMount(mount.containerPath, mount.hostPath))
    .sort((a, b) => a.containerPath.localeCompare(b.containerPath));

  return NextResponse.json({ mounts });
}
