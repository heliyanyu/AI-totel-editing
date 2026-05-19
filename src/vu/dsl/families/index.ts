import type { ZoneTable } from "../interpreter";
import { SVU05_ZONES } from "./svu05";

const REGISTRY: Record<string, ZoneTable> = {
  svu05: SVU05_ZONES,
};

export function getZoneTable(family: string): ZoneTable {
  return REGISTRY[family] ?? SVU05_ZONES;
}

export function hasZoneTable(family: string): boolean {
  return Object.prototype.hasOwnProperty.call(REGISTRY, family);
}

export function knownFamilies(): string[] {
  return Object.keys(REGISTRY);
}
