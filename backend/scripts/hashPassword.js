import bcrypt from 'bcryptjs';
import readline from 'node:readline';

const BCRYPT_COST = 12;
const MAX_PASSWORD_LENGTH = 256;

async function readPipedPassword() {
  let password = '';

  for await (const chunk of process.stdin) {
    password += chunk;
  }

  return password.replace(/\r?\n$/, '');
}

function readHiddenPassword() {
  return new Promise((resolve, reject) => {
    let password = '';
    const input = process.stdin;
    const output = process.stderr;

    readline.emitKeypressEvents(input);
    input.setRawMode(true);
    input.resume();
    output.write('Password: ');

    const finish = () => {
      input.off('keypress', onKeypress);
      input.setRawMode(false);
      input.pause();
      output.write('\n');
    };

    const onKeypress = (character, key) => {
      if (key.ctrl && key.name === 'c') {
        finish();
        reject(new Error('Password entry cancelled'));
        return;
      }

      if (key.name === 'return') {
        finish();
        resolve(password);
        return;
      }

      if (key.name === 'backspace') {
        if (password.length > 0) {
          password = password.slice(0, -1);
          output.write('\b \b');
        }
        return;
      }

      if (!key.ctrl && !key.meta && character) {
        password += character;
        output.write('*');
      }
    };

    input.on('keypress', onKeypress);
  });
}

try {
  const password = process.stdin.isTTY ? await readHiddenPassword() : await readPipedPassword();

  if (!password || password.length > MAX_PASSWORD_LENGTH) {
    throw new Error('Password must contain between 1 and 256 characters');
  }

  console.log(await bcrypt.hash(password, BCRYPT_COST));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
