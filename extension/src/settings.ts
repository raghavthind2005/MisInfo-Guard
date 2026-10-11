import { LlmConfig, PROVIDER_PRESETS, ProviderId } from './llm/provider';
import { BUDGET_PRESETS, Budget, BudgetPreset } from './verify/budget';

/**
 * User settings. Keys never leave the browser except in calls to the
 * provider they belong to.
 */

export interface ProviderSettings {
    apiKey: string;
    /** Overrides the preset's default model when set. */
    model: string;
}

export interface Settings {
    /** The provider tried first; the others with a key act as fallbacks. */
    primaryProvider: ProviderId;
    providers: Record<ProviderId, ProviderSettings>;
    tavilyApiKey: string;
    /** How much automatic checking may spend. */
    budgetPreset: BudgetPreset;
    /** Used when budgetPreset is 'custom'. */
    customBudget: Budget;
}

const STORAGE_KEY = 'settings';

export const PROVIDER_IDS = Object.keys(PROVIDER_PRESETS) as ProviderId[];

export function defaultSettings(): Settings {
    const providers = {} as Record<ProviderId, ProviderSettings>;
    for (const id of PROVIDER_IDS) {
        providers[id] = { apiKey: '', model: '' };
    }
    return {
        primaryProvider: 'gemini',
        providers,
        tavilyApiKey: '',
        budgetPreset: 'balanced',
        customBudget: { ...BUDGET_PRESETS.balanced.budget },
    };
}

export async function loadSettings(): Promise<Settings> {
    const stored = (await chrome.storage.local.get([STORAGE_KEY]))[STORAGE_KEY] as Partial<Settings> | undefined;
    const settings = defaultSettings();
    if (!stored) return settings;

    if (stored.primaryProvider && stored.primaryProvider in PROVIDER_PRESETS) {
        settings.primaryProvider = stored.primaryProvider;
    }
    for (const id of PROVIDER_IDS) {
        settings.providers[id] = { ...settings.providers[id], ...stored.providers?.[id] };
    }
    settings.tavilyApiKey = stored.tavilyApiKey ?? '';
    if (stored.budgetPreset === 'custom' || (stored.budgetPreset && stored.budgetPreset in BUDGET_PRESETS)) {
        settings.budgetPreset = stored.budgetPreset;
    }
    settings.customBudget = { ...settings.customBudget, ...stored.customBudget };
    return settings;
}

export async function saveSettings(settings: Settings): Promise<void> {
    await chrome.storage.local.set({ [STORAGE_KEY]: settings });
}

/**
 * Providers that have a key, primary first. Verification walks this list
 * and moves on when one fails or runs out of quota.
 */
export function providerChain(settings: Settings): LlmConfig[] {
    const order = [settings.primaryProvider, ...PROVIDER_IDS.filter(id => id !== settings.primaryProvider)];
    return order
        .filter(id => settings.providers[id].apiKey.trim() !== '')
        .map(id => ({
            ...PROVIDER_PRESETS[id],
            apiKey: settings.providers[id].apiKey.trim(),
            model: settings.providers[id].model.trim() || PROVIDER_PRESETS[id].model,
        }));
}

export function isConfigured(settings: Settings): boolean {
    return providerChain(settings).length > 0 && settings.tavilyApiKey.trim() !== '';
}

export function effectiveBudget(settings: Settings): Budget {
    return settings.budgetPreset === 'custom' ? settings.customBudget : BUDGET_PRESETS[settings.budgetPreset].budget;
}
