// Speech-to-text using the browser's built-in speech recognition (Safari: Siri dictation,
// Chrome: Google). Free, no API key. If the browser doesn't support it, the mic button is
// simply hidden and the keyboard's own 🎤 key still works.
import { useEffect, useRef, useState, type TextareaHTMLAttributes } from "react";
import { useI18n } from "../i18n";

// Not in TypeScript's DOM types yet, so describe the bits we use.
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
type SRConstructor = new () => SpeechRecognitionLike;

function getRecognition(): SRConstructor | undefined {
  const w = window as unknown as { SpeechRecognition?: SRConstructor; webkitSpeechRecognition?: SRConstructor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export function useDictation(onText: (text: string) => void) {
  const { lang, t } = useI18n();
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string>();
  const rec = useRef<SpeechRecognitionLike | null>(null);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;
  const supported = !!getRecognition();

  useEffect(() => () => rec.current?.stop(), []);

  const toggle = () => {
    if (listening) {
      rec.current?.stop();
      return;
    }
    const SR = getRecognition();
    if (!SR) return;
    const r = new SR();
    r.lang = lang === "de" ? "de-DE" : "en-US";
    r.continuous = true;
    r.interimResults = false;
    r.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) onTextRef.current(e.results[i][0].transcript.trim());
      }
    };
    r.onerror = (e) => {
      if (e.error !== "no-speech" && e.error !== "aborted") {
        setError(e.error === "not-allowed" ? t.micNotAllowed : `${t.dictationError} (${e.error})`);
      }
    };
    r.onend = () => setListening(false);
    setError(undefined);
    try {
      r.start();
      rec.current = r;
      setListening(true);
    } catch (e) {
      setError(`${t.dictationError} (${e instanceof Error ? e.message : String(e)})`);
    }
  };

  return { supported, listening, error, toggle };
}

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange" | "value"> & {
  value: string;
  onChange: (v: string) => void;
};

/** A textarea with a big mic button that appends what you say. */
export function DictationTextarea({ value, onChange, ...rest }: Props) {
  const { t } = useI18n();
  const valueRef = useRef(value);
  valueRef.current = value;
  const d = useDictation((text) => {
    const v = valueRef.current;
    onChange(v && !/\s$/.test(v) ? `${v} ${text}` : v + text);
  });
  return (
    <div className="dictation">
      <textarea {...rest} value={value} onChange={(e) => onChange(e.target.value)} />
      {d.supported && (
        <button type="button" className={`mic ${d.listening ? "on" : ""}`} onClick={d.toggle} aria-pressed={d.listening}>
          {d.listening ? `⏹ ${t.stopDictation}` : `🎤 ${t.dictate}`}
        </button>
      )}
      {d.error && <small className="warn-text">{d.error}</small>}
    </div>
  );
}
