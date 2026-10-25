import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";
import { isIP, BlockList } from "node:net";
const blocks = new BlockList();
const v6blocks = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["192.0.2.0", 24],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  blocks.addSubnet(network, prefix, "ipv4");
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
  ["2001:db8::", 32],
  ["::ffff:0:0", 96],
  ["64:ff9b::", 96],
  ["2002::", 16],
] as const)
  v6blocks.addSubnet(network, prefix, "ipv6");
export function isPublicIP(address: string) {
  const version = isIP(address);
  return version === 4
    ? !blocks.check(address, "ipv4")
    : version === 6 && !v6blocks.check(address, "ipv6");
}
export function validateURL(value: string) {
  const u = new URL(value);
  if (
    !["https:", "http:"].includes(u.protocol) ||
    u.username ||
    u.password ||
    !["", "80", "443"].includes(u.port)
  )
    throw new Error(
      "Only public HTTP(S) URLs on standard ports can be checked.",
    );
  const hostname = u.hostname.replace(/^\[|\]$/g, "");
  if (
    hostname === "localhost" ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    (isIP(hostname) && !isPublicIP(hostname))
  )
    throw new Error("Private and local network URLs are not permitted.");
  return u;
}
export type URLCheck = {
  url: string;
  final_url: string;
  status: number | null;
  redirects: string[];
  error?: string;
};
export async function checkURL(value: string): Promise<URLCheck> {
  const redirects: string[] = [];
  let current = value;
  try {
    for (let hop = 0; hop < 4; hop++) {
      const u = validateURL(current);
      const hostname = u.hostname.replace(/^\[|\]$/g, "");
      let dnsTimer: ReturnType<typeof setTimeout> | undefined;
      const addresses = await Promise.race([
        lookup(hostname, { all: true }),
        new Promise<never>((_, reject) => {
          dnsTimer = setTimeout(
            () =>
              reject(
                new Error("DNS lookup timed out. Manual review required."),
              ),
            6000,
          );
        }),
      ]).finally(() => clearTimeout(dnsTimer));
      if (!addresses.length || addresses.some((a) => !isPublicIP(a.address)))
        throw new Error(
          "The domain resolves to a private, reserved, or unsupported network address.",
        );
      const chosen = addresses[0];
      const result = await new Promise<{ status: number; location?: string }>(
        (resolve, reject) => {
          const transport =
            u.protocol === "https:" ? httpsRequest : httpRequest;
          const request = transport(
            u,
            {
              method: "HEAD",
              family: chosen.family,
              signal: AbortSignal.timeout(8000),
              headers: { "User-Agent": "ProspectAI/1.0 website-status-check" },
              timeout: 8000,
              lookup: (_host, _opts, cb) =>
                cb(null, chosen.address, chosen.family),
            },
            (response) => {
              response.resume();
              resolve({
                status: response.statusCode || 0,
                location: response.headers.location,
              });
            },
          );
          request.on("timeout", () =>
            request.destroy(
              new Error(
                "Website check timed out. This does not establish website absence.",
              ),
            ),
          );
          request.on("error", reject);
          request.end();
        },
      );
      if (result.status >= 300 && result.status < 400 && result.location) {
        current = new URL(result.location, u).toString();
        redirects.push(current);
        continue;
      }
      return {
        url: value,
        final_url: current,
        status: result.status,
        redirects,
      };
    }
    throw new Error("Redirect limit reached. Manual review required.");
  } catch (e) {
    return {
      url: value,
      final_url: current,
      status: null,
      redirects,
      error: e instanceof Error ? e.message : "URL check failed.",
    };
  }
}
