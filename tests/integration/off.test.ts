import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { displayName, mapProduct, validBarcode } from "../../src/lib/off";

const fixture = (n: string) => JSON.parse(readFileSync(`tests/fixtures/${n}.json`, "utf8"));

describe("Open Food Facts mapping", () => {
  it("prefers the Polish name, takes the first brand and the quantity", () => {
    const p = mapProduct(fixture("off-product"), "off");
    expect(p).toEqual({ barcode: "5900820000011", name: "Mleko UHT 2%", brand: "Mlekovita", quantity: "1 l", source: "off" });
    expect(displayName(p!)).toBe("Mleko UHT 2% Mlekovita");
    expect(displayName({ name: "Mlekovita mleko", brand: "Mlekovita" })).toBe("Mlekovita mleko");
  });

  it("falls back to English, then to the main-language name, when there is no Polish name", () => {
    const base = { status: 1, product: { code: "5053990106981", brands: "Pringles", product_name: "Pringles Cașcaval" } };
    expect(mapProduct(base, "off")!.name).toBe("Pringles Cașcaval");
    expect(mapProduct({ ...base, product: { ...base.product, product_name_en: "Pringles Cheese" } }, "off")!.name).toBe("Pringles Cheese");
    expect(mapProduct({ ...base, product: { ...base.product, product_name_en: "Pringles Cheese", generic_name_pl: "Chipsy serowe" } }, "off")!.name).toBe("Chipsy serowe");
  });

  it("returns null for unknown products and products without a name", () => {
    expect(mapProduct(fixture("off-missing"), "off")).toBeNull();
    expect(mapProduct({ status: 1, product: { brands: "X" } }, "obf")).toBeNull();
  });

  it("accepts EAN-13/EAN-8/UPC-A with a valid check digit only", () => {
    expect(validBarcode("5901234123457")).toBe(true);
    expect(validBarcode("5901234123458")).toBe(false);
    expect(validBarcode("96385074")).toBe(true);
    expect(validBarcode("036000291452")).toBe(true);
    expect(validBarcode("12345")).toBe(false);
  });
});
