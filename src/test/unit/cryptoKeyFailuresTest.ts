/*
 * Copyright (c) 2016, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */

import { assert, expect } from 'chai';
import * as os from 'os';
import * as childProcess from 'child_process';
import * as _crypto from 'crypto';
import { testSetup } from '../testSetup';
import { Crypto } from '../../lib/crypto';
import { keyChainImpl } from '../../lib/keyChainImpl';

// Setup the test environment.
const $$ = testSetup();

const spawnReturnFake = {
    sdtoutData: 'stdout test data',
    sdterrData: 'stdout test data',
    stdout: { on: (action, cb) => { cb(spawnReturnFake.sdtoutData); } },
    stderr: { on: (action, cb) => { cb(spawnReturnFake.sdterrData); } },
    on: (action, cb) => { cb(17); },
    stdin: { end: () => {} }
};

if (os.platform() === 'darwin') {
    describe('CryptoKeyFailureTests', () => {

        const OLD_GENERIC_VAL = process.env.SFDX_USE_GENERIC_UNIX_KEYCHAIN;

        before(() => {
            process.env.SFDX_USE_GENERIC_UNIX_KEYCHAIN = 'false';
        });

        after(() => {
            process.env.SFDX_USE_GENERIC_UNIX_KEYCHAIN = OLD_GENERIC_VAL || '';
        });

        it('should throw SetCredentialError when unable to get/set a keychain password', async () => {
            const buf = Buffer.from('testPassword', 'ascii');
            const pwd = buf.toString('hex');
            const programArg = '/usr/bin/security';
            const getOptionsArg = ['find-generic-password', '-a', 'local', '-s', 'sfdx', '-g'];
            const setOptionsArg = ['add-generic-password', '-a', 'local', '-s', 'sfdx', '-w', pwd];
            const currentUser = os.userInfo().username;

            // Setup stubs so that the spawn process to the encryption program returns
            // a fake to cause errors.
            $$.SANDBOX.stub(_crypto, 'randomBytes').returns(buf);
            const spawnStub = $$.SANDBOX.stub(childProcess, 'spawn');
            spawnStub.withArgs(programArg, getOptionsArg).returns(spawnReturnFake);
            spawnStub.withArgs(programArg, setOptionsArg).returns(spawnReturnFake);

            try {
                await new Crypto().init();
                assert.fail('Should have thrown an SetCredentialError for Crypto.init()');
            } catch (err) {
                expect(err.name).to.equal('SetCredentialError');
                expect(err.message).to.equal(`Command failed with response:\n${spawnReturnFake.sdtoutData} - ${spawnReturnFake.sdterrData}`);
                expect(err.actions[0]).to.equal(`Determine why this command failed to set an encryption key for user ${currentUser}: [${programArg} ${setOptionsArg.join(' ')}].`);
            }
        });

        it('should throw PasswordNotFoundError when unable to get/set a keychain password after retry', async () => {
            const programArg = '/usr/bin/security';
            const optionsArg = ['find-generic-password', '-a', 'local', '-s', 'sfdx', '-g'];

            // Setup stubs so that the spawn process to the encryption program returns
            // a fake to cause errors.
            $$.SANDBOX.stub(childProcess, 'spawn').withArgs(programArg, optionsArg).returns(spawnReturnFake);

            try {
                await new Crypto().init('KEY_SET');
                assert.fail('Should have thrown an PasswordNotFoundError for Crypto.init()');
            } catch (err) {
                expect(err.name).to.equal('PasswordNotFoundError');
                expect(err.message).to.equal('Could not find password.\nstdout test data - stdout test data');
                expect(err.actions[0]).to.equal(`Ensure a valid password is returned with the following command: [${programArg} ${optionsArg.join(' ')}].`);
            }
        });

        it('should throw when the OS is not supported', async () => {
            const unsupportedOS = 'LEO';
            $$.SANDBOX.stub(os, 'platform').returns(unsupportedOS);

            try {
                await new Crypto().init();
                assert.fail('Should have thrown an UnsupportedOperatingSystemError for Crypto.init()');
            } catch (err) {
                expect(err.name).to.equal('UnsupportedOperatingSystemError');
                expect(err.message).to.equal(`Unsupported Operating System: ${unsupportedOS}`);
            }
        });
    });
}