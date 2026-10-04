import { describe, it, expect } from "vitest";
import { htmlToPlainText, plainEmailFailureReason } from "./text-utils";

describe("htmlToPlainText", () => {
  it("flattens the PandaDoc-style markup that leaked into a client proposal", () => {
    const raw =
      '<p>- IP67 and fully weatherproof.<br></p><p><span class="redactor-invisible-space">- Built to withstand constant exposure.<br></span></p><p>- The perfect solution.</p>';
    const out = htmlToPlainText(raw);
    expect(out).not.toMatch(/[<>]/);
    expect(out).toContain("- IP67 and fully weatherproof.");
    expect(out).toContain("- Built to withstand constant exposure.");
    expect(out.split("\n").length).toBeGreaterThanOrEqual(3);
  });

  it("leaves already-plain text (including a bare less-than sign) untouched", () => {
    expect(htmlToPlainText("Supports 2 < 3 cameras & a switch")).toBe("Supports 2 < 3 cameras & a switch");
    expect(htmlToPlainText("")).toBe("");
    expect(htmlToPlainText(null)).toBe("");
  });

  it("decodes the common entities left behind after tag removal", () => {
    expect(htmlToPlainText("<p>A&nbsp;&amp;&nbsp;B &lt;ok&gt;</p>")).toBe("A & B <ok>");
  });
});

describe("plainEmailFailureReason", () => {
  it("extracts the human message from a provider JSON payload", () => {
    const raw =
      'Email provider returned 422: {"message":"Invalid `to` field. Please use our testing email address.","name":"validation_error","statusCode":422}';
    expect(plainEmailFailureReason(raw)).toBe("Invalid `to` field. Please use our testing email address.");
  });

  it("falls back to the raw text when there is no JSON, and to a plain sentence when empty", () => {
    expect(plainEmailFailureReason("SMTP connection refused")).toBe("SMTP connection refused");
    expect(plainEmailFailureReason(undefined)).toMatch(/no email provider/);
  });
});
