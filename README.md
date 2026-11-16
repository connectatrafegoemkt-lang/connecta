# CONNECTA CRM

CRM multi-tenant (SaaS) da CONNECTA. Cada cliente (tenant) tem seu próprio
login e acesso **somente** aos próprios dados.

## Stack

- Next.js (App Router) + TypeScript
- Supabase: Postgres com Row Level Security, Auth, Storage e Realtime
- Tailwind CSS

## Funcionalidades (roadmap)

- Leads/contatos, tags
- Funil kanban com etapas editáveis
- Histórico de interações
- Tarefas e lembretes
- Dashboard
- WhatsApp por QR code (uma sessão por tenant, credenciais criptografadas)

## Segurança e isolamento

O isolamento entre tenants é garantido em camadas:

1. **Banco**: `tenant_id NOT NULL` em todas as tabelas de negócio e RLS em todas
   as tabelas.
2. **Servidor**: o tenant é derivado da sessão autenticada; o front nunca envia
   `tenant_id`.
3. **Camada de dados única** que injeta o tenant em toda query.
4. **Testes automatizados** que tentam acessar dados de outro tenant em cada PR.

Veja [CLAUDE.md](./CLAUDE.md) para as regras completas do projeto.
