const _ = require('lodash')
const clone = require('clone')
const traverse = require('traverse')
const DAG = require('dag-map')
const md5 = require('md5')
const {
  checkLocalCircular,
  getRefType,
  getRefValue,
  getRefPathValue,
  getRefFilePath // todo: move into file
} = require('./utils')

function getLoader (refType, options) {
  return (
    options.loaders
      ? options.loaders[refType]
      : null
  )
}

/**
 * Returns the reference schema that refVal points to.
 * If the ref val points to a ref within a file, the file is loaded and fully derefed, before we get the
 * pointing property. Derefed files are cached.
 *
 * @param refVal
 * @param refType
 * @param parent
 * @param options
 * @param state
 * @private
 */
function getRefSchema (refVal, refType, parent, options, state) {
  const loader = getLoader(refType, options)

  if (refType && loader) {
    return loader.getRefSchema(loader, refVal, refType, parent, options, state)
  } else if (refType === 'local') {
    return getRefPathValue(parent, refVal)
  }
}

/**
 * Add to state history
 * @param {Object} state the state
 * @param {String} type ref type
 * @param {String} value ref value
 * @private
 */
function addToHistory (state, type, value) {
  let dest

  if (type === 'file') {
    dest = getRefFilePath(value)
  } else {
    if (value === '#') {
      return false
    }
    dest = state.current.concat(`:${value}`)
  }

  if (dest) {
    dest = dest.toLowerCase()
    if (state.history.indexOf(dest) >= 0) {
      return false
    }

    state.history.push(dest)
  }
  return true
}

/**
 * Set the current into state
 * @param {Object} state the state
 * @param {String} type ref type
 * @param {String} value ref value
 * @private
 */
function setCurrent (state, type, value) {
  let dest
  if (type === 'file') {
    dest = getRefFilePath(value)
  }

  if (dest) {
    state.current = dest
  }
}

/**
 * Derefs $ref types in a schema
 * @param schema
 * @param options
 * @param state
 * @param type
 * @private
 */
function derefSchema (schema, options, state) {
  const check = checkLocalCircular(schema)
  if (check instanceof Error) {
    return check
  }

  if (state.circular) {
    return new Error(`circular references found: ${state.circularRefs.toString()}`)
  } else if (state.error) {
    return state.error
  }

  return traverse(schema).forEach(function (node) {
    if (!_.isNull(node) && !_.isUndefined(null) && typeof node.$ref === 'string') {
      const refType = getRefType(node)
      const refVal = getRefValue(node)

      const addOk = addToHistory(state, refType, refVal)
      if (!addOk) {
        state.circular = true
        state.circularRefs.push(refVal)
        state.error = new Error(`circular references found: ${state.circularRefs.toString()}`)
        this.update(node, true)
      } else {
        setCurrent(state, refType, refVal)
        let newValue = getRefSchema(refVal, refType, schema, options, state)
        state.history.pop()
        if (newValue === undefined) {
          if (state.missing.indexOf(refVal) === -1) {
            state.missing.push(refVal)
          }
          if (options.failOnMissing) {
            state.error = new Error(`Missing $ref: ${refVal}`)
          }
          this.update(node, options.failOnMissing)
        } else {
          if (options.removeIds && newValue.hasOwnProperty('$id')) {
            delete newValue.$id
          }
          if (options.mergeAdditionalProperties) {
            delete node.$ref
            newValue = _.merge({}, newValue, node)
          }
          this.update(newValue)
          if (state.missing.indexOf(refVal) !== -1) {
            state.missing.splice(state.missing.indexOf(refVal), 1)
          }
        }
      }
    }
  })
}

/**
 * Derefs <code>$ref</code>'s in JSON Schema to actual resolved values. Supports local, and file refs.
 * @param {Object} schema - The JSON schema
 * @param {Object} options - options
 * @param {String} options.baseFolder - the base folder to get relative path files from. Default is <code>process.cwd()</code>
 * @param {Boolean} options.failOnMissing - By default missing / unresolved refs will be left as is with their ref value intact.
 *                                        If set to <code>true</code> we will error out on first missing ref that we cannot
 *                                        resolve. Default: <code>false</code>.
 * @param {Boolean} options.mergeAdditionalProperties - By default properties in a object with $ref will be removed in the output.
 *                                                    If set to <code>true</code> they will be added/overwrite the output. This will use lodash's merge function.
 *                                                    Default: <code>false</code>.
 * @param {Boolean} options.removeIds - By default <code>$id</code> fields will get copied when dereferencing.
 *                                    If set to <code>true</code> they will be removed. Merged properties will not get removed.
 *                                    Default: <code>false</code>.
 * @param {Object} options.loaders - A hash mapping reference types (e.g., 'file') to loader functions.
 * @return {Object|Error} the deref schema or an instance of <code>Error</code> if error.
 */
function deref (schema, options) {
  options = _.defaults(options, {
    baseFolder: null,
    cache: {},
    failOnMissing: false,
    loaders: {},
    mergeAdditionalProperties: false,
    removeIds: false
  })

  const state = {
    graph: new DAG(),
    circular: false,
    circularRefs: [],
    cwd: options.baseFolder,
    missing: [],
    history: [],
    cache: options.cache
  }

  try {
    const str = JSON.stringify(schema)
    state.current = md5(str)
  } catch (e) {
    return e
  }

  const baseSchema = clone(schema)

  let ret = derefSchema(baseSchema, options, state)
  if (ret instanceof Error === false && state.error) {
    return state.error
  }
  return ret
}

module.exports = {
  deref,
  derefSchema,
  getLoader
}

module.exports.default = deref
