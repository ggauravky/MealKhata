export class InMemoryMemberAccountRepository {
  constructor(initialAccounts = []) {
    this.accounts = new Map(initialAccounts.map((account) => [account.memberId, { ...account }]));
  }

  async findByEmail(email) {
    const normalized = email?.trim().toLowerCase();
    if (!normalized) {
      return null;
    }
    for (const account of this.accounts.values()) {
      if (account.email === normalized) {
        return { ...account };
      }
    }
    return null;
  }

  async findByMemberId(memberId) {
    const account = this.accounts.get(memberId);
    return account ? { ...account } : null;
  }

  async findAll() {
    return Array.from(this.accounts.values()).map((acc) => ({ ...acc }));
  }

  async upsertAccount({ memberId, email, passwordHash, active = true }) {
    const normalized = email.trim().toLowerCase();
    for (const [id, acc] of this.accounts.entries()) {
      if (id !== memberId && acc.email === normalized) {
        const error = new Error('Duplicate email');
        error.code = 11000;
        throw error;
      }
    }

    const existing = this.accounts.get(memberId);
    const account = {
      memberId,
      email: normalized,
      passwordHash,
      active,
      createdAt: existing?.createdAt ?? new Date(),
      updatedAt: new Date(),
    };
    this.accounts.set(memberId, account);
    return { ...account };
  }
}
