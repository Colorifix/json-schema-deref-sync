const _ = require('lodash')
const validUrl = require('valid-url')
const DAG = require('dag-map')
const traverse = require('traverse')

/**
 * Gets the ref value of a search result from prop-search or ref object
 * @param ref The search result object from prop-search
 * @returns {*} The value of $ref or undefined if not present in search object
 * @private
 */
function getRefValue (ref) {
  const thing = ref ? (ref.value ? ref.value : ref) : null
  if (thing && thing.$ref && typeof thing.$ref === 'string') {
    return thing.$ref
  }
}
exports.getRefValue = getRefValue

/**
 * Gets the type of $ref from search result object.
 * @param ref The search result object from prop-search or a ref object
 * @returns {string}  `web` if it's a web url.
 *                    `file` if it's a file path.
 *                    `local` if it's a link to local schema.
 *                    undefined otherwise
 * @private
 */
function getRefType (ref) {
  const val = getRefValue(ref)
  if (val) {
    if ((val.charAt(0) === '#')) {
      return 'local'
    }

    if (validUrl.isWebUri(val)) {
      return 'web'
    }

    return 'file'
  }
}
exports.getRefType = getRefType

/**
 * Determines if object is a $ref object. That is { $ref: <something> }
 * @param thing object to test
 * @returns {boolean} true if passes the test. false otherwise.
 * @private
 */
function isRefObject (thing) {
  if (thing && typeof thing === 'object' && !Array.isArray(thing)) {
    const keys = Object.keys(thing)
    return keys.length === 1 && keys[0] === '$ref' && typeof thing.$ref === 'string'
  }
  return false
}
exports.isRefObject = isRefObject

/**
 * Gets the value at the ref path within schema
 * @param schema the (root) json schema to search
 * @param refPath string ref path to get within the schema. Ex. `#/definitions/id`
 * @returns {*} Returns the value at the path location or undefined if not found within the given schema
 * @private
 */
function getRefPathValue (schema, refPath) {
  let rpath = refPath
  const hashIndex = refPath.indexOf('#')
  if (hashIndex >= 0) {
    rpath = refPath.substring(hashIndex)
    if (rpath.length > 1) {
      rpath = refPath.substring(1)
    } else {
      rpath = ''
    }
  }

  // Walk through each /-separated path component, and get
  // the value for that key (ignoring empty keys)
  const keys = rpath.split('/').filter(k => !!k)
  return keys.reduce(function (value, key) {
    return value[key]
  }, schema)
}
exports.getRefPathValue = getRefPathValue

function getRefFilePath (refPath) {
  let filePath = refPath
  const hashIndex = filePath.indexOf('#')
  if (hashIndex > 0) {
    filePath = refPath.substring(0, hashIndex)
  }

  return filePath
}
exports.getRefFilePath = getRefFilePath

/**
 * Check the schema for local circular refs using DAG
 * @param {Object} schema the schema
 * @return {Error|undefined} <code>Error</code> if circular ref, <code>undefined</code> otherwise if OK
 * @private
 */
function checkLocalCircular (schema) {
  const dag = new DAG()
  const locals = traverse(schema).reduce(function (acc, node) {
    if (!_.isNull(node) && !_.isUndefined(null) && typeof node.$ref === 'string') {
      const refType = getRefType(node)
      if (refType === 'local') {
        const value = getRefValue(node)
        if (value) {
          const path = this.path.join('/')
          acc.push({
            from: path,
            to: value
          })
        }
      }
    }
    return acc
  }, [])

  if (!locals || !locals.length) {
    return
  }

  if (_.some(locals, elem => elem.to === '#')) {
    return new Error('Circular self reference')
  }

  const check = _.find(locals, elem => {
    const fromEdge = elem.from.concat('/')
    const dest = elem.to.substring(2).concat('/')
    try {
      dag.addEdge(fromEdge, dest)
    } catch (e) {
      return elem
    }

    if (fromEdge.indexOf(dest) === 0) {
      return elem
    }
  })

  if (check) {
    return new Error(`Circular self reference from ${check.from} to ${check.to}`)
  }
}

exports.checkLocalCircular = checkLocalCircular
