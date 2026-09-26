import { describe, expect, it } from "vitest";
import { ApiError } from "../api/client";
import { apiErrorMessage } from "./apiError";

describe("apiErrorMessage", () => {
  it("pulls the server's error out of an API failure", () => {
    const err = new ApiError(400, "Bad Request", JSON.stringify({ error: "name and body are required" }));
    expect(apiErrorMessage(err)).toBe("name and body are required");
  });

  it("keeps the raw message when the body isn't JSON", () => {
    const err = new ApiError(502, "Bad Gateway", "<html>upstream down</html>");
    expect(apiErrorMessage(err)).toBe("502 Bad Gateway: <html>upstream down</html>");
  });

  it("handles plain errors and non-errors", () => {
    expect(apiErrorMessage(new Error("network down"))).toBe("network down");
    expect(apiErrorMessage("oops")).toBe("oops");
  });
});

describe("ApiError", () => {
  it("exposes the parsed body, e.g. Sync's needsReconnect", () => {
    const err = new ApiError(502, "Bad Gateway", JSON.stringify({ error: "token revoked", needsReconnect: true }));
    expect(err.status).toBe(502);
    expect(err.body).toEqual({ error: "token revoked", needsReconnect: true });
  });
});
