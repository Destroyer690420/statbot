import { useState } from 'react';
import { Save, Sun, Moon, Monitor } from 'lucide-react';

export function Settings() {
  const [theme, setTheme] = useState('dark');

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="max-w-2xl space-y-6">
        {/* Theme Selection */}
        <div className="glass-card p-6">
          <h3 className="text-lg font-semibold text-white mb-4">Dashboard Theme</h3>
          <div className="grid grid-cols-3 gap-4">
            <button
              onClick={() => setTheme('dark')}
              className={`p-4 rounded-xl border-2 transition-all ${
                theme === 'dark'
                  ? 'border-primary-500 bg-primary-900/20'
                  : 'border-dark-700 bg-dark-800/50 hover:border-dark-500'
              }`}
            >
              <Moon className="w-6 h-6 text-primary-400 mx-auto mb-2" />
              <p className="text-sm text-white font-medium">Dark</p>
            </button>
            <button
              onClick={() => setTheme('light')}
              className={`p-4 rounded-xl border-2 transition-all ${
                theme === 'light'
                  ? 'border-primary-500 bg-primary-900/20'
                  : 'border-dark-700 bg-dark-800/50 hover:border-dark-500'
              }`}
            >
              <Sun className="w-6 h-6 text-yellow-400 mx-auto mb-2" />
              <p className="text-sm text-white font-medium">Light</p>
            </button>
            <button
              onClick={() => setTheme('system')}
              className={`p-4 rounded-xl border-2 transition-all ${
                theme === 'system'
                  ? 'border-primary-500 bg-primary-900/20'
                  : 'border-dark-700 bg-dark-800/50 hover:border-dark-500'
              }`}
            >
              <Monitor className="w-6 h-6 text-dark-300 mx-auto mb-2" />
              <p className="text-sm text-white font-medium">System</p>
            </button>
          </div>
        </div>

        {/* Reminder Delays */}
        <div className="glass-card p-6">
          <h3 className="text-lg font-semibold text-white mb-4">Reminder Delays</h3>
          <p className="text-dark-400 text-sm mb-4">
            Configured in environment variables. Restart required for changes.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-dark-800/50 rounded-xl p-4 border border-dark-700/50">
              <p className="text-dark-400 text-xs font-medium mb-1">Post 20H</p>
              <p className="text-white font-mono text-lg">20 hours</p>
            </div>
            <div className="bg-dark-800/50 rounded-xl p-4 border border-dark-700/50">
              <p className="text-dark-400 text-xs font-medium mb-1">Post 70H</p>
              <p className="text-white font-mono text-lg">70 hours</p>
            </div>
            <div className="bg-dark-800/50 rounded-xl p-4 border border-dark-700/50">
              <p className="text-dark-400 text-xs font-medium mb-1">Comment 20H</p>
              <p className="text-white font-mono text-lg">20 hours</p>
            </div>
          </div>
        </div>

        {/* Retry Configuration */}
        <div className="glass-card p-6">
          <h3 className="text-lg font-semibold text-white mb-4">Retry Configuration</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-dark-800/50 rounded-xl p-4 border border-dark-700/50">
              <p className="text-dark-400 text-xs font-medium mb-1">First Retry</p>
              <p className="text-white font-mono text-lg">+2 hours</p>
            </div>
            <div className="bg-dark-800/50 rounded-xl p-4 border border-dark-700/50">
              <p className="text-dark-400 text-xs font-medium mb-1">Second Retry</p>
              <p className="text-white font-mono text-lg">+6 hours</p>
            </div>
          </div>
        </div>

        {/* Save Button */}
        <button className="btn-primary flex items-center gap-2 px-6 py-2.5" disabled>
          <Save className="w-4 h-4" />
          Save Preferences (Coming Soon)
        </button>
      </div>
    </div>
  );
}
