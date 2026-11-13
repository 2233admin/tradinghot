// The class joiner the vendored Rare UI components use.
//
// Source: Rare UI, github.com/swamimalode07/rare-ui (MIT + Commons Clause + Attribution);
// the `cn` helper is taken from its lib/utils.ts.
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
