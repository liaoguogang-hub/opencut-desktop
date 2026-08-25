import type { TActionWithOptionalArgs } from "./types";

/**
 * Alt is also regarded as macOS OPTION (⌥) key
 * Ctrl is also regarded as macOS COMMAND (⌘) key (NOTE: this differs from HTML Keyboard spec where COMMAND is Meta key!)
 */
export type ModifierKeys =
	| "ctrl"
	| "alt"
	| "shift"
	| "ctrl+shift"
	| "alt+shift"
	| "ctrl+alt"
	| "ctrl+alt+shift";

const KEYS = [
	"a", "b", "c", "d", "e", "f", "g", "h", "i", "j",
	"k", "l", "m", "n", "o", "p", "q", "r", "s", "t",
	"u", "v", "w", "x", "y", "z",
	"0", "1", "2", "3", "4", "5", "6", "7", "8", "9",
	"up", "down", "left", "right",
	"/", "?", ".",
	"enter", "tab", "space", "escape", "esc",
	"backspace", "delete", "home", "end",
] as const;

export type Key = (typeof KEYS)[number];

const KEY_SET: ReadonlySet<string> = new Set(KEYS);

export function isKey(value: string): value is Key {
	return KEY_SET.has(value);
}

export type ModifierBasedShortcutKey = `${ModifierKeys}+${Key}`;
// Singular keybindings (these will be disabled when an input-ish area has been focused)
export type SingleCharacterShortcutKey = `${Key}`;

export type ShortcutKey = ModifierBasedShortcutKey | SingleCharacterShortcutKey;

/**
 * Type guard for {@link ShortcutKey} values parsed from persisted JSON.
 *
 * Accepts the bare form `Key` (e.g. `"a"`) and any `ModifierKeys+Key`
 * combination (e.g. `"ctrl+shift+z"`), rejecting anything else. Used by
 * `keybindings/persistence.ts` to validate deserialised state.
 */
export function isShortcutKey(value: string): value is ShortcutKey {
	if (isKey(value)) return true;
	const plusIndex = value.indexOf("+");
	if (plusIndex <= 0 || plusIndex === value.length - 1) return false;
	const head = value.slice(0, plusIndex) as ModifierKeys;
	const tail = value.slice(plusIndex + 1);
	if (!(head in MODIFIER_SET)) return false;
	return isKey(tail);
}

const MODIFIER_SET: ReadonlySet<string> = new Set([
	"ctrl",
	"alt",
	"shift",
	"ctrl+shift",
	"alt+shift",
	"ctrl+alt",
	"ctrl+alt+shift",
]);

export type KeybindingConfig = {
	[key in ShortcutKey]?: TActionWithOptionalArgs;
};
