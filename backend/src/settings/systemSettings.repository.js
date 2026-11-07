import { SystemSettings } from './systemSettings.model.js';

export const systemSettingsRepository = Object.freeze({
  async get({ session } = {}) {
    return SystemSettings.findOne({ settingsId: 'system' }).session(session ?? null).lean().exec();
  },
});
