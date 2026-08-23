import { Container, Input, type SettingItem, SettingsList, Spacer, Text } from "@earendil-works/pi-tui";
import { type ModelContextSettings, validateModelContextSettings } from "../../../core/settings-manager.ts";
import { getSettingsListTheme, theme } from "../theme/theme.ts";
import { DynamicBorder } from "./dynamic-border.ts";

/**
 * Parse a user-entered token count. In the `k`/`m` shorthand case a `.` is a
 * decimal point (`1.5k` → 1500, `2.75m` → 2750000); otherwise `,`/`.`/whitespace
 * are thousands separators (`160,000` / `160.000` / `160 000` → 160000).
 */
export function parseTokenCount(input: string): number | undefined {
	const cleaned = input.replace(/[\s,]/g, "");
	if (cleaned.length === 0) return undefined;

	const shorthand = /^(\d+(?:\.\d+)?)([kKmM])$/.exec(cleaned);
	if (shorthand) {
		const value = Number(shorthand[1]);
		const multiplier = shorthand[2].toLowerCase() === "k" ? 1_000 : 1_000_000;
		return Math.round(value * multiplier);
	}

	const plain = cleaned.replace(/\./g, "");
	if (!/^\d+$/.test(plain)) return undefined;
	return Number(plain);
}

interface NumberInputOptions {
	title: string;
	prompt: string;
	initialValue: number | undefined;
	validate: (value: number | undefined) => string | undefined;
	onCommit: (value: number | undefined) => void;
	onCancel: () => void;
}

/** Prompt for a numeric token count with validation, used by the /context submenus. */
class NumberInputComponent extends Container {
	private input: Input;
	private errorText: Text;
	private readonly options: NumberInputOptions;

	constructor(options: NumberInputOptions) {
		super();
		this.options = options;
		this.addChild(new DynamicBorder());
		this.addChild(new Spacer(1));
		this.addChild(new Text(theme.bold(theme.fg("accent", options.title)), 0, 0));
		this.addChild(new Spacer(1));
		this.addChild(new Text(theme.fg("muted", options.prompt), 0, 0));
		this.addChild(new Spacer(1));

		this.input = new Input();
		if (options.initialValue !== undefined) this.input.setValue(String(options.initialValue));
		this.input.onSubmit = (raw) => this.commit(raw);
		this.input.onEscape = () => options.onCancel();
		this.addChild(this.input);

		this.errorText = new Text("", 0, 0);
		this.addChild(this.errorText);

		this.addChild(new Text(theme.fg("dim", "  Enter to apply · Esc to cancel (leave empty to reset)"), 0, 0));
		this.addChild(new DynamicBorder());
	}

	private commit(raw: string): void {
		const value = raw.trim() === "" ? undefined : parseTokenCount(raw);
		if (raw.trim() !== "" && value === undefined) {
			this.errorText.setText(theme.fg("error", "Invalid number. Use e.g. 160000, 160k, or 160,000."));
			return;
		}
		const error = this.options.validate(value);
		if (error) {
			this.errorText.setText(theme.fg("error", error));
			return;
		}
		this.options.onCommit(value);
	}

	handleInput(data: string): void {
		this.input.handleInput(data);
	}
}

export type ContextConfigValues = ModelContextSettings;

/**
 * Configures per-model context settings: max context (capped at the model spec)
 * and compaction boundary (absolute tokens, must be below max context).
 */
export class ContextConfigComponent extends Container {
	private settingsList: SettingsList;

	constructor(
		values: ContextConfigValues,
		modelSpec: number,
		onChange: (next: ContextConfigValues) => void,
		onCancel: () => void,
	) {
		super();

		let current: ContextConfigValues = { ...values };
		const commit = (next: ContextConfigValues): void => {
			current = { ...current, ...next };
			onChange({ ...current });
		};

		const formatValue = (value: number | undefined): string => (value === undefined ? "unset" : `${value}`);

		const items: SettingItem[] = [
			{
				id: "max-context",
				label: "Max context",
				description: `Effective context window (capped at the model spec of ${modelSpec})`,
				currentValue: formatValue(values.maxContext),
				submenu: (_currentValue, done) =>
					new NumberInputComponent({
						title: "Max context",
						prompt: `Enter a token count (capped at ${modelSpec}). Empty resets to the model spec.`,
						initialValue: current.maxContext,
						validate: (value) => validateModelContextSettings({ ...current, maxContext: value }, modelSpec),
						onCommit: (value) => {
							commit({ maxContext: value });
							done(value === undefined ? "unset" : `${value}`);
						},
						onCancel: () => done(),
					}),
			},
			{
				id: "compaction-boundary",
				label: "Compaction boundary",
				description: "Context usage (tokens) that triggers auto-compaction; must be below max context",
				currentValue: formatValue(values.compactionBoundary),
				submenu: (_currentValue, done) =>
					new NumberInputComponent({
						title: "Compaction boundary",
						prompt: `Enter a token count (must be below max context). Empty resets.`,
						initialValue: current.compactionBoundary,
						validate: (value) =>
							validateModelContextSettings({ ...current, compactionBoundary: value }, modelSpec),
						onCommit: (value) => {
							commit({ compactionBoundary: value });
							done(value === undefined ? "unset" : `${value}`);
						},
						onCancel: () => done(),
					}),
			},
		];

		this.addChild(new DynamicBorder());
		this.addChild(new Spacer(1));
		this.addChild(new Text(theme.bold(theme.fg("accent", "Context")), 0, 0));
		this.addChild(new Spacer(1));
		this.settingsList = new SettingsList(items, 10, getSettingsListTheme(), () => {}, onCancel);
		this.addChild(this.settingsList);
		this.addChild(new DynamicBorder());
	}

	handleInput(data: string): void {
		this.settingsList.handleInput(data);
	}
}
