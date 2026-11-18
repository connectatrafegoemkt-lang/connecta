/**
 * Catálogo de permissões (espelha app.permission_catalog() no banco — um
 * teste garante que os dois continuam iguais).
 */
export const PERMISSIONS = [
  { key: "contatos.ver", label: "Ver contatos", group: "Contatos" },
  { key: "contatos.editar", label: "Criar e editar contatos (e mover no funil)", group: "Contatos" },
  { key: "contatos.excluir", label: "Excluir contatos", group: "Contatos" },
  { key: "tarefas.editar", label: "Criar e editar tarefas", group: "Tarefas" },
  { key: "whatsapp.ver", label: "Ver conversas do WhatsApp", group: "WhatsApp" },
  { key: "whatsapp.enviar", label: "Enviar mensagens no WhatsApp", group: "WhatsApp" },
  { key: "whatsapp.conectar", label: "Conectar/desconectar o número (QR code)", group: "WhatsApp" },
  { key: "ia.configurar", label: "Configurar o atendimento por IA", group: "Administração" },
  { key: "configuracoes.gerenciar", label: "Gerenciar funil, tags e mensagens rápidas", group: "Administração" },
  { key: "equipe.gerenciar", label: "Gerenciar equipe e setores", group: "Administração" },
  { key: "auditoria.ver", label: "Ver auditoria", group: "Administração" },
  { key: "setores.todos", label: "Ver contatos de todos os setores", group: "Setores" },
] as const;

export type Permission = (typeof PERMISSIONS)[number]["key"];
export const PERMISSION_KEYS = PERMISSIONS.map((p) => p.key) as Permission[];

export const PROFILES = [
  { key: "admin", label: "Administrador", hint: "Acesso total, inclusive equipe e IA." },
  { key: "gerente", label: "Gerente", hint: "Vê todos os setores, edita, exclui e configura o funil." },
  { key: "atendente", label: "Atendente", hint: "Atende contatos e WhatsApp dos seus setores." },
  { key: "leitura", label: "Só leitura", hint: "Vê contatos e conversas, sem alterar nada." },
] as const;
export type Profile = (typeof PROFILES)[number]["key"];

export const PROFILE_PERMISSIONS: Record<Profile, Permission[]> = {
  admin: [...PERMISSION_KEYS],
  gerente: [
    "contatos.ver", "contatos.editar", "contatos.excluir", "tarefas.editar",
    "whatsapp.ver", "whatsapp.enviar", "configuracoes.gerenciar", "auditoria.ver", "setores.todos",
  ],
  atendente: ["contatos.ver", "contatos.editar", "tarefas.editar", "whatsapp.ver", "whatsapp.enviar"],
  leitura: ["contatos.ver", "whatsapp.ver"],
};

export const profileLabel = (p: string) => PROFILES.find((x) => x.key === p)?.label ?? p;
