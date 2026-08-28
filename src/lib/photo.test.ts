import { describe, expect, it } from "vitest";
import { parsePhotoPath, photoKey, photoUrl } from "./photo";

const DAY = "2026-08-26";
const ID = "3f2a1b4c-5d6e-4f70-8192-a3b4c5d6e7f8";

describe("photoKey", () => {
  it("puts the day in front so the bucket is browsable", () => {
    expect(photoKey(DAY, ID, "full")).toBe(`${DAY}/${ID}`);
    expect(photoKey(DAY, ID, "thumb")).toBe(`${DAY}/${ID}-thumb`);
  });
});

describe("parsePhotoPath", () => {
  it("reads both variants", () => {
    expect(parsePhotoPath(`/_photo/${DAY}/${ID}`)).toEqual({
      day: DAY,
      id: ID,
      variant: "full",
    });
    expect(parsePhotoPath(`/_photo/${DAY}/${ID}/thumb`)).toEqual({
      day: DAY,
      id: ID,
      variant: "thumb",
    });
  });

  it("round-trips what photoUrl builds", () => {
    for (const variant of ["full", "thumb"] as const) {
      expect(parsePhotoPath(photoUrl(DAY, ID, variant))).toEqual({
        day: DAY,
        id: ID,
        variant,
      });
    }
  });

  // The parser is the only thing between a URL and an R2 key, so a rejected
  // shape here is what stops a crafted path from reading another object.
  it("refuses traversal", () => {
    for (const bad of [
      `/_photo/../${ID}`,
      `/_photo/${DAY}/..`,
      `/_photo/${DAY}/../../secret`,
      `/_photo/${DAY}/${ID}/../thumb`,
    ]) {
      expect(parsePhotoPath(bad)).toBeNull();
    }
  });

  it("refuses a day that is not a real date", () => {
    // Same hole as ?d=2026-02-31: shape-valid, calendar-invalid.
    expect(parsePhotoPath(`/_photo/2026-02-31/${ID}`)).toBeNull();
    expect(parsePhotoPath(`/_photo/2026-13-01/${ID}`)).toBeNull();
    expect(parsePhotoPath(`/_photo/nonsense/${ID}`)).toBeNull();
  });

  it("refuses an id that is not a uuid", () => {
    for (const bad of ["abc", "", `${ID}x`, ID.toUpperCase()]) {
      expect(parsePhotoPath(`/_photo/${DAY}/${bad}`)).toBeNull();
    }
  });

  it("refuses the wrong shape entirely", () => {
    for (const bad of [
      "/_photo",
      `/_photo/${DAY}`,
      `/_photo/${DAY}/${ID}/`,
      `/_photo/${DAY}/${ID}/full`,
      `/_photo/${DAY}/${ID}/thumb/extra`,
      `/photo/${DAY}/${ID}`,
      `/_server/${DAY}/${ID}`,
    ]) {
      expect(parsePhotoPath(bad)).toBeNull();
    }
  });
});
