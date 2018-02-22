/*
 * Copyright (c) 2016, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root  or https://opensource.org/licenses/BSD-3-Clause
 */

'use strict';

// Node

import { isNil as _isNil } from 'lodash';
import { Messages } from '../messages';
import { ConfigFile } from './configFile';
import { SfdxUtil } from '../util';
import { SfdxError } from '../sfdxError';

const SFDX_CONFIG_FILE_NAME = 'sfdx-config.json';

/**
 * Internal helper to validate the ENOENT error type.
 * @param err - The error object to check.
 * @returns {Object} The contents object bound to "this"
 * @throws re-throws all other errors.
 * @private
 */
const _checkEnoent = function(err) {
    if (err.code === 'ENOENT') {
        this.contents = {};
        return this.contents;
    } else {
        throw err;
    }
};

/**
 * Interface for meta information about config properties
 */
export interface ConfigPropertyMeta {

    /**
     *  The config property name
     */
    key: string;

    /**
     *  Reference to the config data input validation
     */
    input?: ConfigPropertyMetaInput;

    /**
     *  True if the property should be indirectly hidden from the user.
     */
    hidden?: boolean;
}

/**
 * Config property input validation
 */
export interface ConfigPropertyMetaInput {

    /**
     * Test if the input value is valid.
     * @param value - the input value
     * @returns - {boolean} Returns true if the input data is valid.
     */
    validator: (value) => {};

    /**
     * The message to return in the error if the validation fails.
     */
    failedMessage: string;
}

export class SfdxConfig extends ConfigFile {

    /**
     * Username associated with the default dev hub org
     * @type {string}
     */
    public static readonly DEFAULT_DEV_HUB_USERNAME = 'defaultdevhubusername';

    /**
     * Username associate with the default org
     * @type {string}
     */
    public static readonly DEFAULT_USERNAME = 'defaultusername';

    /**
     * A function to retrieve the sfdx project root.
     * @callback rootPathRetriever
     * @param {boolean} isGlobal True for a global config. False for a local config.
     * @returns {Promise<string>} The property.
     */

    /**
     * Static initializer
     * @param {boolean} isGlobal - True of the returned config is a global config. False for local.
     * @param {rootPathRetriever} rootPathRetriever - A function to retrieve the sfdx project root.
     * @returns {Promise<SfdxConfig>} - A global or local config object
     */
    public static async create(isGlobal: boolean = true,
                               rootPathRetriever?: (isGlobal: boolean) => Promise<string>): Promise<SfdxConfig> {

        if (!SfdxConfig.messages) {
            SfdxConfig.messages = Messages.loadMessages('sfdx-core', 'config');
        }

        if (!SfdxConfig.allowedProperties) {
            SfdxConfig.allowedProperties = [
                {
                    key: 'instanceUrl',
                    input: {
                        // If a value is provided validate it otherwise no value is unset.
                        validator: (value) => _isNil(value) || SfdxUtil.isSalesforceDomain(value),
                        failedMessage: SfdxConfig.messages.getMessage('invalidInstanceUrl')
                    }
                },
                {
                    key: 'apiVersion',
                    hidden: true,
                    input: {
                        // If a value is provided validate it otherwise no value is unset.
                        validator: (value) => _isNil(value) || /[1-9]\d\.0/.test(value),
                        failedMessage: SfdxConfig.messages.getMessage('invalidApiVersion')
                    }
                },
                { key: SfdxConfig.DEFAULT_DEV_HUB_USERNAME },
                { key: SfdxConfig.DEFAULT_USERNAME }
            ];
        }
        const config: SfdxConfig = rootPathRetriever ?
            new SfdxConfig(await rootPathRetriever(isGlobal) , isGlobal) :
            new SfdxConfig(await SfdxConfig.resolveRootFolder(isGlobal) , isGlobal);

        await config.read();

        return config;
    }

    /**
     * @returns {ConfigPropertyMeta[]} Returns an object representing the supported allowed properties.
     */
    public static getAllowedProperties(): ConfigPropertyMeta[] {
        if (!SfdxConfig.allowedProperties) {
            throw new SfdxError('SfdxConfig meta information has not been initialized. Use SfdxConfigcreate()');
        }
        return SfdxConfig.allowedProperties;
    }

    /**
     * The value of a supported config property
     * @param {boolean} isGlobal - True for a global config. False for a local config.
     * @param {string} propertyName - The name of the property to set
     * @param {string | boolean} value - The property value
     * @param {rootPathRetriever} rootPathRetriever A function to retrieve the sfdx project root.
     * @returns {Promise<object>}
     */
    public static async setPropertyValue(isGlobal: boolean, propertyName: string, value?: string | boolean,
                                         rootPathRetriever?: (isGlobal: boolean) => Promise<string>): Promise<object> {

        const rootFolder = rootPathRetriever ?
            await rootPathRetriever(isGlobal) : await SfdxConfig.resolveRootFolder(isGlobal);

        const config = new SfdxConfig(rootFolder, isGlobal);

        const content = await config.read();

        if (_isNil(value)) {
            delete content[propertyName];
        } else {
            content[propertyName] = value;
        }

        return config.write(content);
    }

    /**
     * Clear all the configured properties both local and global
     * @returns {Promise<void>}
     */
    public static async clear(): Promise<void> {
        let config  = await SfdxConfig.create(true);
        await config.write({});

        config = await SfdxConfig.create(false);
        await config.write({});
    }

    private static allowedProperties: ConfigPropertyMeta[];
    private static messages: Messages;

    /**
     * Constructor
     * @param {string} rootFolder - The root folder to use and if the root folder is the global config dir.
     * @param {boolean} isGlobal - True for a global config false for a local config.
     */
    protected constructor(rootFolder: string, isGlobal: boolean) {
        super(rootFolder, SFDX_CONFIG_FILE_NAME, isGlobal, true);
    }

    /**
     * @returns {Promise<object>} Read, assign, and return the config contents.
     */
    public async read(): Promise<object> {
        try {
            await this.setContents(await SfdxUtil.readJSON(this.path, false));
            return this.getContents();
        } catch (err) {
            _checkEnoent.call(this, err);
        }
    }

    /**
     * Sets a value for a property
     * @param {string} propertyName - The property to set.
     * @param {string | boolean} value - The value of the property
     * @returns {Promise<void>}
     */
    public async setPropertyValue(propertyName: string, value: string | boolean) {

        const property = SfdxConfig.allowedProperties.find((allowedProp) => allowedProp.key === propertyName);
        if (!property) {
            throw SfdxError.create('sfdx-core', 'config', 'UnknownConfigKey', [propertyName]);
        }
        if (property.input) {
            if (property.input && property.input.validator(value)) {
                this.contents[property.key] = value;
            } else {
                throw SfdxError.create('sfdx-core', 'config', 'invalidConfigValue', [property.input.failedMessage]);
            }
        } else {
            this.contents[property.key] = value;
        }
    }
}

/**
 * Supported Org Default Types
 * @type {object}
 */
export const ORG_DEFAULT = {
    /** {string} Default Developer Hub Username */
    DEVHUB: SfdxConfig.DEFAULT_DEV_HUB_USERNAME,
    /** {string} Default Username */
    USERNAME: SfdxConfig.DEFAULT_USERNAME,

    /**
     * List the Org defaults
     * @returns {stringp[]} List of default orgs
     */
    list() {
        return [ORG_DEFAULT.DEVHUB, ORG_DEFAULT.USERNAME];
    }
};