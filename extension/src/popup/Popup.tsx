import { useState, useEffect } from 'preact/hooks';
import { isConfigured, loadSettings } from '../settings';
import './popup.css';

export function Popup() {
    const [isEnabled, setIsEnabled] = useState(true);
    const [stats, setStats] = useState({ claimsChecked: 0, warningsFound: 0 });
    const [needsSetup, setNeedsSetup] = useState(false);

    useEffect(() => {
        // Load initial state from storage
        chrome.storage.local.get(['isEnabled', 'claimsChecked', 'warningsFound'], (result) => {
            setIsEnabled(result.isEnabled ?? true);
            setStats({
                claimsChecked: result.claimsChecked || 0,
                warningsFound: result.warningsFound || 0
            });
        });
        loadSettings().then(settings => setNeedsSetup(!isConfigured(settings)));
    }, []);

    const toggleExtension = () => {
        const newState = !isEnabled;
        setIsEnabled(newState);

        // Save to storage
        chrome.storage.local.set({ isEnabled: newState });

        // Notify active tabs
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]?.id) {
                chrome.tabs.sendMessage(tabs[0].id, {
                    type: 'TOGGLE_EXTENSION',
                    isEnabled: newState
                });
            }
        });
    };

    return (
        <div className="popup-container">
            <header className="header">
                <div className="logo-area">
                    <span className="shield-icon">🛡️</span>
                    <h1>MisInfo Guard</h1>
                </div>
                <div className="status-badge" data-enabled={isEnabled}>
                    {isEnabled ? 'Active' : 'Paused'}
                </div>
            </header>

            <main className="main-content">
                {needsSetup && (
                    <button className="setup-notice" onClick={() => chrome.runtime.openOptionsPage()}>
                        Add your API keys to start checking claims →
                    </button>
                )}
                <div className="toggle-area" onClick={toggleExtension}>
                    <div className={`toggle-switch ${isEnabled ? 'on' : 'off'}`}>
                        <div className="toggle-thumb" />
                    </div>
                    <span className="toggle-label">
                        {isEnabled ? 'Protection enabled' : 'Protection paused'}
                    </span>
                </div>

                <div className="stats-grid">
                    <div className="stat-card">
                        <span className="stat-value">{stats.claimsChecked}</span>
                        <span className="stat-label">Claims Scanned</span>
                    </div>
                    <div className="stat-card warning">
                        <span className="stat-value">{stats.warningsFound}</span>
                        <span className="stat-label">Issues Found</span>
                    </div>
                </div>
            </main>

            <footer className="footer">
                <a className="options-link" onClick={() => chrome.runtime.openOptionsPage()}>Options</a>
                <div className="shortcut-hint">
                    Shortuct: <kbd>Cmd</kbd> + <kbd>Shift</kbd> + <kbd>M</kbd>
                </div>
            </footer>
        </div>
    );
}
