import { useId, useState, type ComponentPropsWithoutRef } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import './auth.css';

type PasswordFieldProps = Omit<ComponentPropsWithoutRef<'input'>, 'id' | 'type'> & {
  label?: string;
  hint?: string;
};

export function PasswordField({ label = 'Password', hint, ...input }: PasswordFieldProps) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  const action = visible ? 'Hide password' : 'Show password';

  return <div className="field">
    <span><label htmlFor={id}>{label}</label></span>
    <div className="password-field-input">
      <input
        {...input}
        id={id}
        type={visible ? 'text' : 'password'}
        aria-describedby={hint ? `${id}-hint` : undefined}
        autoCapitalize="none"
        spellCheck={false}
      />
      <button type="button" aria-label={action} aria-controls={id} title={action} onClick={() => setVisible(value => !value)}>
        {visible ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
      </button>
    </div>
    {hint && <small id={`${id}-hint`}>{hint}</small>}
  </div>;
}
