-- 428: limites do bucket do Desbloqueio de CE (auditoria de segurança run-3,
-- decisão do dono em 2026-10-22).
--
-- O bucket `ce-unlock-documents` nasceu na 139 sem tamanho máximo nem tipos
-- aceitos. O upload passa pela Edge Function `portal-ce-unlock-document`, que
-- só aceita PDF e o DOCX do modelo do termo até 10 MB (`_shared/ceUnlockFile.ts`)
-- e grava com esse `contentType`. Agora o próprio Storage recusa o que fugir
-- disso, mesmo que outro caminho de escrita apareça: 10 MB (10485760 bytes),
-- `application/pdf` e o DOCX
-- (`application/vnd.openxmlformats-officedocument.wordprocessingml.document`).
--
-- Grava a configuração do bucket, não dado de negócio: os arquivos já
-- guardados ficam como estão. Sem `storage.buckets` com as colunas de limite
-- (banco sem Storage), o bloco não faz nada.
-- Rollback: `UPDATE storage.buckets SET file_size_limit = NULL,
-- allowed_mime_types = NULL WHERE id = 'ce-unlock-documents'`.

DO $ce_unlock_bucket$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'storage' AND table_name = 'buckets' AND column_name = 'allowed_mime_types'
  ) THEN
    EXECUTE $sql$
      UPDATE storage.buckets
         SET file_size_limit = 10485760,
             allowed_mime_types = ARRAY['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
       WHERE id = 'ce-unlock-documents'
    $sql$;
  END IF;
END;
$ce_unlock_bucket$;
