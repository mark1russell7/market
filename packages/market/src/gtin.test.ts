import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { gtinCheckDigit, parseGtin } from "./gtin.ts";

const digits = (length: number): fc.Arbitrary<string> =>
  fc.array(fc.integer({ min: 0, max: 9 }), { minLength: length, maxLength: length }).map((list) => list.join(""));
const valid: fc.Arbitrary<string> = fc
  .constantFrom(7, 11, 12, 13)
  .chain(digits)
  .map((body) => `${body}${gtinCheckDigit(body)}`)
  .filter((code) => !/^0+$/.test(code));

describe("gtinCheckDigit", () => {
  it("gives the check digits of known codes", () => {
    expect(gtinCheckDigit("03600029145")).toBe(2);
    expect(gtinCheckDigit("400638133393")).toBe(1);
    expect(gtinCheckDigit("9638507")).toBe(4);
    expect(gtinCheckDigit("0")).toBe(0);
    expect(gtinCheckDigit("1")).toBe(7);
    expect(gtinCheckDigit("10")).toBe(9);
  });

  it("refuses a text that is not a string of digits", () => {
    expect(() => gtinCheckDigit("")).toThrow(new RangeError('The text "" is not a string of digits.'));
    expect(() => gtinCheckDigit("12a4")).toThrow(RangeError);
    expect(() => gtinCheckDigit(" 1234")).toThrow(RangeError);
  });
});

describe("parseGtin", () => {
  it("gives the GTIN-14 form of each length", () => {
    expect(parseGtin("96385074")).toBe("00000096385074");
    expect(parseGtin("036000291452")).toBe("00036000291452");
    expect(parseGtin("4006381333931")).toBe("04006381333931");
    expect(parseGtin("00036000291452")).toBe("00036000291452");
  });

  it("removes spaces and hyphens", () => {
    expect(parseGtin(" 0 36000-29145 2\t")).toBe("00036000291452");
  });

  it("refuses a wrong check digit, a wrong length, a letter and zeros only", () => {
    expect(parseGtin("036000291453")).toBeNull();
    expect(parseGtin("03600029145")).toBeNull();
    expect(parseGtin("000036000291452")).toBeNull();
    expect(parseGtin("0360002914a2")).toBeNull();
    expect(parseGtin("00000000")).toBeNull();
    expect(parseGtin("000000000000")).toBeNull();
    expect(parseGtin("")).toBeNull();
    expect(parseGtin("+36000291452")).toBeNull();
  });

  it("accepts each code with its check digit, and pads it to 14 digits", () => {
    fc.assert(
      fc.property(valid, (code) => {
        expect(parseGtin(code)).toBe(code.padStart(14, "0"));
      }),
    );
  });

  it("refuses each change of one digit", () => {
    fc.assert(
      fc.property(valid, fc.nat(), fc.integer({ min: 1, max: 9 }), (code, at, delta) => {
        const index = at % code.length;
        const digit = (Number(code[index]) + delta) % 10;
        const changed = `${code.slice(0, index)}${digit}${code.slice(index + 1)}`;
        expect(parseGtin(changed)).toBeNull();
      }),
    );
  });
});
