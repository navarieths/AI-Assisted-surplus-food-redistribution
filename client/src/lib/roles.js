export const ROLE_HOME = {
  provider: '/provider',
  recipient: '/inbox',
  volunteer: '/volunteer',
  delivery_partner: '/volunteer',
};

export function getRoleHome(role) {
  return ROLE_HOME[role] || '/home';
}