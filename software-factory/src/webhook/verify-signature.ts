import { createHmac, timingSafeEqual } from "node:crypto";

const SIGNATURE_PREFIX = "sha256=";

export type VerifySignatureInput = {
  rawBody: Buffer;
  signatureHeader: string | undefined;
  secret: string;
};

export const verifyWebhookSignature = (
  input: VerifySignatureInput
): boolean => {
  const { rawBody, signatureHeader, secret } = input;
  if (!signatureHeader || !signatureHeader.startsWith(SIGNATURE_PREFIX)) {
    return false;
  }

  const expectedHex = createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");
  const expectedBuffer = Buffer.from(
    `${SIGNATURE_PREFIX}${expectedHex}`,
    "utf8"
  );
  const receivedBuffer = Buffer.from(signatureHeader, "utf8");

  if (receivedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(receivedBuffer, expectedBuffer);
};
