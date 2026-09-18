import { describe, expect, it } from "vitest";
import { decryptField, encryptField, mask, randomToken, safeEqual, sha256 } from "./crypto";

describe("crypto", () => {
  it("round-trips field encryption with a fresh IV each time", () => {
    const a = encryptField("ABCDE1234F");
    const b = encryptField("ABCDE1234F");
    expect(a).not.toEqual(b);
    expect(decryptField(a)).toBe("ABCDE1234F");
    expect(decryptField(b)).toBe("ABCDE1234F");
  });
  it("rejects tampered ciphertext", () => {
    const enc = encryptField("secret");
    const parts = enc.split(".");
    parts[3] = parts[3].slice(0, -2) + "AA";
    expect(() => decryptField(parts.join("."))).toThrow();
  });
  it("returns null for empty / malformed payloads", () => {
    expect(decryptField(null)).toBeNull();
    expect(decryptField("garbage")).toBeNull();
  });
  it("masks all but the last 4", () => {
    expect(mask("ABCDE1234F")).toBe("******234F");
    expect(mask("12")).toBe("**");
    expect(mask(null)).toBeNull();
  });
  it("hashes deterministically and compares safely", () => {
    expect(sha256("x")).toBe(sha256("x"));
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(randomToken().length).toBeGreaterThan(40);
  });
});
