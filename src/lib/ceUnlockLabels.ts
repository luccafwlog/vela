export const ceStateLabel = (state: string) =>
  ({
    draft: "Rascunho",
    submitted: "Enviado",
    in_review: "Em análise",
    changes_requested: "Correção solicitada",
    cancelled: "Cancelado",
    completed: "Concluído",
    no_request: "Sem solicitação",
    approved: "Aprovado",
    uploaded: "Aguardando análise",
    revoked: "Revogado",
    uploading: "Upload pendente",
    not_exported: "Não exportado",
    exported: "Exportado — aguardando confirmação",
    confirmed: "Desbloqueio confirmado",
    sent: "Enviado à ZPT — aguardando confirmação",
  })[state] ?? state;

export const ceActionLabel = (action: string) =>
  ({
    draft: "Rascunho criado",
    submit: "Pedido enviado",
    review: "Documento analisado",
    delivery: "Entrega física atualizada",
    cancel: "Pedido cancelado",
    confirm: "Desbloqueio confirmado",
    apply_vip: "Renovação VIP aplicada",
    set_vip: "Condição VIP atualizada",
    reconfirm_ce: "CE reconferido",
    export: "Planilha gerada",
    sent: "Envio à ZPT registrado",
    upload_termo: "Termo apresentado",
    upload_procuracao: "Procuração apresentada",
    upload_model: "Modelo disponibilizado",
    expire_draft: "Rascunho expirado por inatividade",
  })[action] ?? "Andamento atualizado";
