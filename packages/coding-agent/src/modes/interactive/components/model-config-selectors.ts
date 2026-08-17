import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import {
	Container,
	Input,
	type SelectItem,
	SelectList,
	type SettingItem,
	SettingsList,
	Spacer,
	Text,
} from "@earendil-works/pi-tui";
import type { ModelContextSettings } from "../../../core/settings-manager.ts";
import { getSelectListTheme, getSettingsListTheme, theme } from "../theme/theme.ts";
import { DynamicBorder } from "./dynamic-border.ts";
import { THINKING_DESCRIPTIONS } from "./settings-selector.ts";

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

/** Effort/reasoning level selector for the current model. */
export class EffortSelectorComponent extends Container {
	private selectList: SelectList;

	constructor(
		levels: readonly ThinkingLevel[],
		current: ThinkingLevel,
		onSelect: (level: ThinkingLevel) => void,
		onCancel: () => void,
	) {
		super();
		this.addChild(new DynamicBorder());
		this.addChild(new Spacer(1));
		this.addChild(new Text(theme.bold(theme.fg("accent", "Effort")), 0, 0));
		this.addChild(new Spacer(1));
		this.addChild(new Text(theme.fg("muted", "Select the reasoning depth for this model."), 0, 0));
		this.addChild(new Spacer(1));

		const items: SelectItem[] = levels.map((level) => ({
			value: level,
			label: level,
			description: THINKING_DESCRIPTIONS[level],
		}));
		this.selectList = new SelectList(items, Math.min(items.length, 10), getSelectListTheme());
		const currentIndex = items.findIndex((item) => item.value === current);
		if (currentIndex !== -1) this.selectList.setSelectedIndex(currentIndex);
		this.selectList.onSelect = (item) => onSelect(item.value as ThinkingLevel);
		this.selectList.onCancel = onCancel;
		this.addChild(this.selectList);
		this.addChild(new Spacer(1));
		this.addChild(new Text(theme.fg("dim", "  Enter to select · Esc to cancel"), 0, 0));
		this.addChild(new DynamicBorder());
	}

	handleInput(data: string): void {
		this.selectList.handleInput(data);
	}
}

interface NumberInputOptions {
	title: string;
	prompt: string;
	initialValue: number | undefined;
	validate: (value: number) => string | undefined;
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
		if (raw.trim() === "") {
			this.options.onCommit(undefined);
			return;
		}
		const value = parseTokenCount(raw);
		if (value === undefined) {
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
						initialValue: values.maxContext,
						validate: (value) =>
							value > modelSpec ? `Must be at most the model spec (${modelSpec}).` : undefined,
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
						initialValue: values.compactionBoundary,
						validate: (value) => {
							const max = current.maxContext ?? modelSpec;
							if (value >= max) return `Must be less than max context (${max}).`;
							return undefined;
						},
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
