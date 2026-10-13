import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { totpQrSvg } from "./totp-qr";

const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0h1v1H0z"/></svg>';

void describe("totpQrSvg", () => {
  void it("reads a plain SVG data URI", () => {
    assert.equal(totpQrSvg(`data:image/svg+xml;utf-8,${svg}`), svg);
  });

  void it("reads a percent-encoded SVG data URI", () => {
    assert.equal(totpQrSvg(`data:image/svg+xml;utf-8,${encodeURIComponent(svg)}`), svg);
  });

  void it("reads a base64 SVG data URI", () => {
    assert.equal(totpQrSvg(`data:image/svg+xml;base64,${btoa(svg)}`), svg);
  });

  void it("rejects missing or non-SVG input", () => {
    assert.equal(totpQrSvg(undefined), null);
    assert.equal(totpQrSvg("data:image/png;base64,AAAA"), null);
    assert.equal(totpQrSvg("data:image/svg+xml;utf-8,%E0%A4%A"), null);
    assert.equal(totpQrSvg("data:image/svg+xml;utf-8,<script/>"), null);
  });
});
