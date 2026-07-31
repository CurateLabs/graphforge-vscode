import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  allSettingDescriptors,
  SETTINGS_CATEGORIES,
  SETTINGS_SECTION,
} from "../webview/settingsSchema";

/**
 * The Settings webview schema (`src/webview/settingsSchema.ts`) restates the
 * contributed configuration in analyst language. These tests pin it to
 * `package.json#contributes.configuration` so the two can't drift: a setting
 * added/removed/retyped in package.json must be reflected in the webview
 * schema in the same change, and vice versa.
 */

interface ContributedProperty {
  type: string;
  default?: unknown;
  enum?: string[];
}

function contributedProperties(): Record<string, ContributedProperty> {
  // dist/test/settingsSchema.test.js → repo root is two levels up.
  const packageJsonPath = path.join(__dirname, "..", "..", "package.json");
  const manifest = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as {
    contributes: { configuration: { properties: Record<string, ContributedProperty> } };
  };
  return manifest.contributes.configuration.properties;
}

suite("settingsSchema ↔ package.json contributes.configuration", () => {
  test("every contributed graphforge.* setting appears in exactly one category", () => {
    const contributed = Object.keys(contributedProperties());
    const schemaKeys = allSettingDescriptors().map((s) => `${SETTINGS_SECTION}.${s.key}`);

    for (const key of contributed) {
      const count = schemaKeys.filter((k) => k === key).length;
      assert.equal(count, 1, `${key} must appear in exactly one settings category (found ${count})`);
    }
  });

  test("every schema descriptor maps to a contributed setting", () => {
    const contributed = contributedProperties();
    for (const descriptor of allSettingDescriptors()) {
      const key = `${SETTINGS_SECTION}.${descriptor.key}`;
      assert.ok(contributed[key], `${key} is in the webview schema but not contributed`);
    }
  });

  test("types, enum options, and defaults match the contributed configuration", () => {
    const contributed = contributedProperties();
    for (const descriptor of allSettingDescriptors()) {
      const key = `${SETTINGS_SECTION}.${descriptor.key}`;
      const property = contributed[key];

      const expectedType = descriptor.type === "boolean" ? "boolean" : "string";
      assert.equal(property.type, expectedType, `${key}: contributed type mismatch`);

      if (descriptor.type === "enum") {
        assert.ok(property.enum, `${key}: schema says enum but package.json has no enum`);
        assert.deepEqual(
          (descriptor.options ?? []).map((option) => option.value).sort(),
          [...property.enum].sort(),
          `${key}: enum option values must match package.json`,
        );
      } else {
        assert.equal(property.enum, undefined, `${key}: package.json has enum but schema does not`);
      }

      assert.equal(descriptor.default, property.default, `${key}: default mismatch`);
    }
  });

  test("categories are well-formed (unique ids, non-empty, labeled copy)", () => {
    const ids = SETTINGS_CATEGORIES.map((category) => category.id);
    assert.equal(new Set(ids).size, ids.length, "category ids must be unique");

    for (const category of SETTINGS_CATEGORIES) {
      assert.ok(category.label.length > 0, `${category.id}: label required`);
      assert.ok(category.blurb.length > 0, `${category.id}: blurb required`);
      assert.ok(
        category.settings.length > 0,
        `${category.id}: empty categories are stub UI — remove or fill`,
      );
      for (const setting of category.settings) {
        assert.ok(setting.label.length > 0, `${setting.key}: label required`);
        assert.ok(setting.description.length > 0, `${setting.key}: description required`);
        if (setting.type === "enum") {
          assert.ok((setting.options ?? []).length >= 2, `${setting.key}: enum needs ≥2 options`);
          for (const option of setting.options ?? []) {
            assert.ok(option.label.length > 0, `${setting.key}.${option.value}: option label`);
            assert.ok(
              option.description.length > 0,
              `${setting.key}.${option.value}: option description`,
            );
          }
        }
      }
    }
  });
});
