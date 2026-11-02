import { LANGUAGES, useI18n, type Lang } from '../i18n';

export function LanguageSelect() {
  const { lang, setLang } = useI18n();
  return (
    <label className="flex items-center gap-2 text-sm text-slate-600">
      <span className="sr-only">Language</span>
      <select
        className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm"
        value={lang}
        onChange={(e) => setLang(e.target.value as Lang)}
        aria-label="Language"
      >
        {LANGUAGES.map((l) => (
          <option key={l.value} value={l.value}>
            {l.label}
          </option>
        ))}
      </select>
    </label>
  );
}
