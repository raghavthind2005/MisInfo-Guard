import { useEffect, useState } from 'preact/hooks';
import { PROVIDER_PRESETS, ProviderId } from '../llm/provider';
import { IndexManifest } from '../memory/factCheckIndex';
import { downloadIndex, loadStoredManifest } from '../memory/store';
import { PROVIDER_IDS, Settings, defaultSettings, effectiveBudget, isConfigured, loadSettings, saveSettings } from '../settings';
import { BUDGET_PRESETS, Budget, BudgetPreset, Usage, loadUsage } from '../verify/budget';
import './options.css';

const KEY_LINKS: Record<ProviderId, string> = {
    gemini: 'https://aistudio.google.com/apikey',
    sarvam: 'https://dashboard.sarvam.ai',
};

export function Options() {
    const [settings, setSettings] = useState<Settings>(defaultSettings());
    const [saved, setSaved] = useState(false);
    const [database, setDatabase] = useState<IndexManifest | null>(null);
    const [download, setDownload] = useState<{ state: 'idle' | 'running' | 'failed'; detail: string }>({ state: 'idle', detail: '' });

    const [usage, setUsage] = useState<Usage | null>(null);

    useEffect(() => {
        loadSettings().then(setSettings);
        loadStoredManifest().then(setDatabase);
        loadUsage().then(setUsage);
    }, []);

    const budget = effectiveBudget(settings);
    const updateCustomBudget = (field: keyof Budget, value: string) => {
        const amount = Math.max(0, Math.floor(Number(value) || 0));
        update({ ...settings, customBudget: { ...settings.customBudget, [field]: amount } });
    };

    const updateDatabase = async () => {
        setDownload({ state: 'running', detail: 'Starting...' });
        try {
            const manifest = await downloadIndex(fraction => {
                setDownload({ state: 'running', detail: `${Math.round(fraction * 100)}%` });
            });
            setDatabase(manifest);
            setDownload({ state: 'idle', detail: '' });
            chrome.runtime.sendMessage({ type: 'INDEX_UPDATED' });
        } catch (err) {
            setDownload({ state: 'failed', detail: err instanceof Error ? err.message : 'Download failed' });
        }
    };

    const update = (next: Settings) => {
        setSettings(next);
        setSaved(false);
    };

    const updateProvider = (id: ProviderId, field: 'apiKey' | 'model', value: string) => {
        update({
            ...settings,
            providers: { ...settings.providers, [id]: { ...settings.providers[id], [field]: value } },
        });
    };

    const save = async (event: Event) => {
        event.preventDefault();
        await saveSettings(settings);
        setSaved(true);
    };

    return (
        <form className="options" onSubmit={save}>
            <h1>🛡️ MisInfo Guard</h1>
            <p className="intro">
                MisInfo Guard runs on your own API keys. They are stored only in this browser and are sent
                only to the service they belong to.
            </p>

            <section>
                <h2>Language model</h2>
                <p className="hint">
                    Add a key for at least one provider. If the first choice fails or runs out of quota,
                    the other is used.
                </p>

                {PROVIDER_IDS.map(id => (
                    <fieldset key={id}>
                        <legend>
                            <label>
                                <input
                                    type="radio"
                                    name="primary"
                                    checked={settings.primaryProvider === id}
                                    onChange={() => update({ ...settings, primaryProvider: id })}
                                />
                                {PROVIDER_PRESETS[id].label}
                                {settings.primaryProvider === id && <span className="badge">first choice</span>}
                            </label>
                        </legend>
                        <label className="field">
                            <span>API key (<a href={KEY_LINKS[id]} target="_blank" rel="noopener noreferrer">get one</a>)</span>
                            <input
                                type="password"
                                autocomplete="off"
                                value={settings.providers[id].apiKey}
                                onInput={e => updateProvider(id, 'apiKey', e.currentTarget.value)}
                            />
                        </label>
                        <label className="field">
                            <span>Model</span>
                            <input
                                type="text"
                                placeholder={PROVIDER_PRESETS[id].model}
                                value={settings.providers[id].model}
                                onInput={e => updateProvider(id, 'model', e.currentTarget.value)}
                            />
                        </label>
                    </fieldset>
                ))}
            </section>

            <section>
                <h2>Evidence search</h2>
                <p className="hint">Each claim that is checked uses one Tavily search credit.</p>
                <label className="field">
                    <span>Tavily API key (<a href="https://app.tavily.com" target="_blank" rel="noopener noreferrer">get one</a>)</span>
                    <input
                        type="password"
                        autocomplete="off"
                        value={settings.tavilyApiKey}
                        onInput={e => update({ ...settings, tavilyApiKey: e.currentTarget.value })}
                    />
                </label>
            </section>

            <section>
                <h2>Automatic checking</h2>
                <p className="hint">
                    How much MisInfo Guard may spend on its own while you read. Checks you start yourself
                    from a tooltip are always allowed.
                </p>

                {(Object.keys(BUDGET_PRESETS) as Exclude<BudgetPreset, 'custom'>[]).map(id => (
                    <label className="choice" key={id}>
                        <input
                            type="radio"
                            name="budget"
                            checked={settings.budgetPreset === id}
                            onChange={() => update({ ...settings, budgetPreset: id })}
                        />
                        <span><b>{BUDGET_PRESETS[id].label}</b> — {BUDGET_PRESETS[id].description}</span>
                    </label>
                ))}
                <label className="choice">
                    <input
                        type="radio"
                        name="budget"
                        checked={settings.budgetPreset === 'custom'}
                        onChange={() => update({ ...settings, budgetPreset: 'custom' })}
                    />
                    <span><b>Custom</b> — set your own limits.</span>
                </label>

                {settings.budgetPreset === 'custom' && (
                    <div className="budget-grid">
                        <label className="field">
                            <span>Model calls per day</span>
                            <input type="number" min="0" value={settings.customBudget.dailyLlmCalls}
                                onInput={e => updateCustomBudget('dailyLlmCalls', e.currentTarget.value)} />
                        </label>
                        <label className="field">
                            <span>Searches per month</span>
                            <input type="number" min="0" value={settings.customBudget.monthlySearches}
                                onInput={e => updateCustomBudget('monthlySearches', e.currentTarget.value)} />
                        </label>
                        <label className="field">
                            <span>Searches per article</span>
                            <input type="number" min="0" value={settings.customBudget.maxChecksPerPage}
                                onInput={e => updateCustomBudget('maxChecksPerPage', e.currentTarget.value)} />
                        </label>
                    </div>
                )}

                {usage && (
                    <p className="usage">
                        Used so far: {usage.llmCallsToday} of {budget.dailyLlmCalls} model calls today,{' '}
                        {usage.searchesThisMonth} of {budget.monthlySearches} searches this month.
                    </p>
                )}
            </section>

            <section>
                <h2>Fact-check database</h2>
                <p className="hint">
                    A local index of published fact-checks. Pages are compared against it on your device,
                    with no API calls. The download is about 30 MB.
                </p>
                <p className="database-status">
                    {database
                        ? `Installed: ${database.count.toLocaleString()} fact-checks, built ${database.builtAt.slice(0, 10)}.`
                        : 'Not installed.'}
                </p>
                <div className="actions">
                    <button type="button" className="secondary" disabled={download.state === 'running'} onClick={updateDatabase}>
                        {download.state === 'running' ? `Downloading ${download.detail}` : database ? 'Update database' : 'Download database'}
                    </button>
                    {download.state === 'failed' && <span className="status warn">{download.detail}</span>}
                </div>
            </section>

            <div className="actions">
                <button type="submit">Save</button>
                {saved && (
                    <span className={isConfigured(settings) ? 'status ok' : 'status warn'}>
                        {isConfigured(settings)
                            ? 'Saved. Claim checking is ready.'
                            : 'Saved, but checking needs one model key and a Tavily key.'}
                    </span>
                )}
            </div>
        </form>
    );
}
