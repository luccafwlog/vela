import { forwardRef, useState, type InputHTMLAttributes } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { Input } from '../ui/Input'
import { markLabelableControl } from '../ui/labelableControls'

/**
 * Campo de senha com "Mostrar senha" para as telas de acesso e troca de senha
 * (etapa 02). Repassa ao `<input>` os atributos que o `Field` injeta
 * (`aria-describedby`, `aria-invalid`, `required`), então o rótulo, a ajuda e
 * o erro continuam ligados ao campo. O botão alterna só a exibição; o valor
 * nunca sai do campo.
 */
export const PasswordInput = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>>(
  function PasswordInput({ className, ...props }, ref) {
    const [visible, setVisible] = useState(false)
    return (
      <span className="app-password">
        <Input ref={ref} {...props} type={visible ? 'text' : 'password'} className={['app-password__input', className].filter(Boolean).join(' ')} />
        <button
          type="button"
          className="app-password__toggle"
          aria-label={visible ? 'Ocultar senha' : 'Mostrar senha'}
          aria-pressed={visible}
          onClick={() => setVisible((current) => !current)}
        >
          {visible ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
        </button>
      </span>
    )
  },
)

markLabelableControl(PasswordInput)
