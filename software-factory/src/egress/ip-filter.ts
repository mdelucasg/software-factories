import { isIP } from "node:net";

export type IpCheckResult =
  | { allowed: true; normalizedIp: string; family: 4 | 6 }
  | { allowed: false; reason: string };

type BlockedIpv4Range = {
  network: number;
  mask: number;
  reason: string;
};

const IPV4_OCTET_PATTERN = /^(0|[1-9]\d{0,2})$/;
const IPV6_HEX_GROUP_PATTERN = /^[0-9a-fA-F]{1,4}$/;
const NUMERIC_IPV4_SEGMENT_PATTERN = /^(0x[0-9a-f]+|0[0-7]*|[1-9]\d*)$/i;

const stripBrackets = (rawHost: string): string => {
  const trimmed = rawHost.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
};

const parseIpv4ToUint32 = (address: string): number | null => {
  const octets = address.split(".");
  if (octets.length !== 4) {
    return null;
  }

  let packed = 0;
  for (const octet of octets) {
    if (!IPV4_OCTET_PATTERN.test(octet)) {
      return null;
    }
    const numeric = Number(octet);
    if (numeric > 255) {
      return null;
    }
    packed = ((packed << 8) | numeric) >>> 0;
  }
  return packed;
};

const createIpv4Range = (
  cidrBase: string,
  prefixLength: number,
  reason: string
): BlockedIpv4Range => {
  const baseAddress = parseIpv4ToUint32(cidrBase);
  if (baseAddress === null) {
    throw new Error(`Invalid CIDR base address: ${cidrBase}`);
  }
  const mask =
    prefixLength === 0 ? 0 : (0xffffffff << (32 - prefixLength)) >>> 0;
  return {
    network: (baseAddress & mask) >>> 0,
    mask,
    reason,
  };
};

const BLOCKED_IPV4_RANGES: readonly BlockedIpv4Range[] = [
  createIpv4Range("0.0.0.0", 8, "ipv4_unspecified"),
  createIpv4Range("10.0.0.0", 8, "ipv4_rfc1918_10"),
  createIpv4Range("100.64.0.0", 10, "ipv4_cgnat_tailscale"),
  createIpv4Range("127.0.0.0", 8, "ipv4_loopback"),
  createIpv4Range("169.254.0.0", 16, "ipv4_link_local"),
  createIpv4Range("172.16.0.0", 12, "ipv4_rfc1918_172"),
  createIpv4Range("192.168.0.0", 16, "ipv4_rfc1918_192"),
  createIpv4Range("224.0.0.0", 4, "ipv4_multicast"),
  createIpv4Range("240.0.0.0", 4, "ipv4_reserved"),
];

const formatIpv4FromUint32 = (packed: number): string =>
  [
    (packed >>> 24) & 0xff,
    (packed >>> 16) & 0xff,
    (packed >>> 8) & 0xff,
    packed & 0xff,
  ].join(".");

const classifyIpv4 = (address: string): IpCheckResult => {
  const packed = parseIpv4ToUint32(address);
  if (packed === null) {
    return { allowed: false, reason: "invalid_ipv4" };
  }

  for (const range of BLOCKED_IPV4_RANGES) {
    if ((packed & range.mask) >>> 0 === range.network) {
      return { allowed: false, reason: range.reason };
    }
  }

  return {
    allowed: true,
    normalizedIp: formatIpv4FromUint32(packed),
    family: 4,
  };
};

const parseIpv6Section = (section: string): number[] | null => {
  if (section.length === 0) {
    return [];
  }
  const tokens = section.split(":");
  const words: number[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === undefined) {
      return null;
    }
    if (token.includes(".")) {
      if (index !== tokens.length - 1) {
        return null;
      }
      const embeddedIpv4 = parseIpv4ToUint32(token);
      if (embeddedIpv4 === null) {
        return null;
      }
      words.push((embeddedIpv4 >>> 16) & 0xffff, embeddedIpv4 & 0xffff);
      continue;
    }
    if (!IPV6_HEX_GROUP_PATTERN.test(token)) {
      return null;
    }
    words.push(Number.parseInt(token, 16));
  }

  return words;
};

const parseIpv6Words = (address: string): number[] | null => {
  if (address.includes("%")) {
    return null;
  }

  const halves = address.split("::");
  if (halves.length > 2) {
    return null;
  }

  const leftWords = parseIpv6Section(halves[0] ?? "");
  if (leftWords === null) {
    return null;
  }

  if (halves.length === 1) {
    return leftWords.length === 8 ? leftWords : null;
  }

  const rightWords = parseIpv6Section(halves[1] ?? "");
  if (rightWords === null) {
    return null;
  }

  const missingCount = 8 - (leftWords.length + rightWords.length);
  if (missingCount < 1) {
    return null;
  }

  return [
    ...leftWords,
    ...new Array<number>(missingCount).fill(0),
    ...rightWords,
  ];
};

const isAllZeroPrefix = (words: readonly number[], count: number): boolean => {
  for (let index = 0; index < count; index += 1) {
    if (words[index] !== 0) {
      return false;
    }
  }
  return true;
};

const classifyIpv6 = (address: string): IpCheckResult => {
  const words = parseIpv6Words(address);
  if (words === null) {
    return { allowed: false, reason: "invalid_ipv6" };
  }

  const firstWord = words[0] ?? 0;
  const sixthWord = words[5] ?? 0;
  const seventhWord = words[6] ?? 0;
  const eighthWord = words[7] ?? 0;

  if (isAllZeroPrefix(words, 5) && sixthWord === 0xffff) {
    const embeddedIpv4 = ((seventhWord << 16) | eighthWord) >>> 0;
    return classifyIpv4(formatIpv4FromUint32(embeddedIpv4));
  }

  if (isAllZeroPrefix(words, 6)) {
    return { allowed: false, reason: "ipv6_reserved_prefix" };
  }
  if ((firstWord & 0xfe00) === 0xfc00) {
    return { allowed: false, reason: "ipv6_ula" };
  }
  if ((firstWord & 0xffc0) === 0xfe80) {
    return { allowed: false, reason: "ipv6_link_local" };
  }
  if ((firstWord & 0xffc0) === 0xfec0) {
    return { allowed: false, reason: "ipv6_site_local" };
  }
  if ((firstWord & 0xff00) === 0xff00) {
    return { allowed: false, reason: "ipv6_multicast" };
  }

  return {
    allowed: true,
    normalizedIp: address.toLowerCase(),
    family: 6,
  };
};

export const isIpLiteral = (rawHost: string): boolean => {
  const unbracketed = stripBrackets(rawHost);
  if (unbracketed.length === 0) {
    return false;
  }
  if (isIP(unbracketed) !== 0) {
    return true;
  }
  if (unbracketed.includes(":")) {
    return parseIpv6Words(unbracketed) !== null;
  }
  const segments = unbracketed.split(".");
  if (segments.length < 1 || segments.length > 4) {
    return false;
  }
  return segments.every((segment) =>
    NUMERIC_IPV4_SEGMENT_PATTERN.test(segment)
  );
};

export const classifyIpAddress = (rawAddress: string): IpCheckResult => {
  const unbracketed = stripBrackets(rawAddress);
  if (unbracketed.length === 0) {
    return { allowed: false, reason: "empty_ip" };
  }
  if (unbracketed.includes(":")) {
    return classifyIpv6(unbracketed);
  }
  return classifyIpv4(unbracketed);
};
