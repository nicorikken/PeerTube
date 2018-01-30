import * as Bluebird from 'bluebird'
import * as express from 'express'
import 'express-validator'
import { body, param } from 'express-validator/check'
import { omit } from 'lodash'
import { isIdOrUUIDValid } from '../../helpers/custom-validators/misc'
import {
  isAvatarFile,
  isUserAutoPlayVideoValid,
  isUserDisplayNSFWValid,
  isUserPasswordValid,
  isUserRoleValid,
  isUserUsernameValid,
  isUserVideoQuotaValid
} from '../../helpers/custom-validators/users'
import { isVideoExist } from '../../helpers/custom-validators/videos'
import { logger } from '../../helpers/logger'
import { isSignupAllowed } from '../../helpers/utils'
import { CONSTRAINTS_FIELDS } from '../../initializers'
import { Redis } from '../../lib/redis'
import { UserModel } from '../../models/account/user'
import { areValidationErrors } from './utils'

const usersAddValidator = [
  body('username').custom(isUserUsernameValid).withMessage('Should have a valid username (lowercase alphanumeric characters)'),
  body('password').custom(isUserPasswordValid).withMessage('Should have a valid password'),
  body('email').isEmail().withMessage('Should have a valid email'),
  body('videoQuota').custom(isUserVideoQuotaValid).withMessage('Should have a valid user quota'),
  body('role').custom(isUserRoleValid).withMessage('Should have a valid role'),

  async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    logger.debug('Checking usersAdd parameters', { parameters: omit(req.body, 'password') })

    if (areValidationErrors(req, res)) return
    if (!await checkUserNameOrEmailDoesNotAlreadyExist(req.body.username, req.body.email, res)) return

    return next()
  }
]

const usersRegisterValidator = [
  body('username').custom(isUserUsernameValid).withMessage('Should have a valid username'),
  body('password').custom(isUserPasswordValid).withMessage('Should have a valid password'),
  body('email').isEmail().withMessage('Should have a valid email'),

  async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    logger.debug('Checking usersRegister parameters', { parameters: omit(req.body, 'password') })

    if (areValidationErrors(req, res)) return
    if (!await checkUserNameOrEmailDoesNotAlreadyExist(req.body.username, req.body.email, res)) return

    return next()
  }
]

const usersRemoveValidator = [
  param('id').isInt().not().isEmpty().withMessage('Should have a valid id'),

  async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    logger.debug('Checking usersRemove parameters', { parameters: req.params })

    if (areValidationErrors(req, res)) return
    if (!await checkUserIdExist(req.params.id, res)) return

    const user = res.locals.user
    if (user.username === 'root') {
      return res.status(400)
                .send({ error: 'Cannot remove the root user' })
                .end()
    }

    return next()
  }
]

const usersUpdateValidator = [
  param('id').isInt().not().isEmpty().withMessage('Should have a valid id'),
  body('email').optional().isEmail().withMessage('Should have a valid email attribute'),
  body('videoQuota').optional().custom(isUserVideoQuotaValid).withMessage('Should have a valid user quota'),
  body('role').optional().custom(isUserRoleValid).withMessage('Should have a valid role'),

  async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    logger.debug('Checking usersUpdate parameters', { parameters: req.body })

    if (areValidationErrors(req, res)) return
    if (!await checkUserIdExist(req.params.id, res)) return

    const user = res.locals.user
    if (user.username === 'root' && req.body.role !== undefined && user.role !== req.body.role) {
      return res.status(400)
        .send({ error: 'Cannot change root role.' })
        .end()
    }

    return next()
  }
]

const usersUpdateMeValidator = [
  body('password').optional().custom(isUserPasswordValid).withMessage('Should have a valid password'),
  body('email').optional().isEmail().withMessage('Should have a valid email attribute'),
  body('displayNSFW').optional().custom(isUserDisplayNSFWValid).withMessage('Should have a valid display Not Safe For Work attribute'),
  body('autoPlayVideo').optional().custom(isUserAutoPlayVideoValid).withMessage('Should have a valid automatically plays video attribute'),

  (req: express.Request, res: express.Response, next: express.NextFunction) => {
    // TODO: Add old password verification
    logger.debug('Checking usersUpdateMe parameters', { parameters: omit(req.body, 'password') })

    if (areValidationErrors(req, res)) return

    return next()
  }
]

const usersUpdateMyAvatarValidator = [
  body('avatarfile').custom((value, { req }) => isAvatarFile(req.files)).withMessage(
    'This file is not supported. Please, make sure it is of the following type : '
    + CONSTRAINTS_FIELDS.ACTORS.AVATAR.EXTNAME.join(', ')
  ),

  (req: express.Request, res: express.Response, next: express.NextFunction) => {
    logger.debug('Checking usersUpdateMyAvatarValidator parameters', { files: req.files })

    if (areValidationErrors(req, res)) return

    const imageFile = req.files['avatarfile'][0] as Express.Multer.File
    if (imageFile.size > CONSTRAINTS_FIELDS.ACTORS.AVATAR.FILE_SIZE.max) {
      res.status(400)
        .send({ error: `The size of the avatar is too big (>${CONSTRAINTS_FIELDS.ACTORS.AVATAR.FILE_SIZE.max}).` })
        .end()
      return
    }

    return next()
  }
]

const usersGetValidator = [
  param('id').isInt().not().isEmpty().withMessage('Should have a valid id'),

  async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    logger.debug('Checking usersGet parameters', { parameters: req.params })

    if (areValidationErrors(req, res)) return
    if (!await checkUserIdExist(req.params.id, res)) return

    return next()
  }
]

const usersVideoRatingValidator = [
  param('videoId').custom(isIdOrUUIDValid).not().isEmpty().withMessage('Should have a valid video id'),

  async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    logger.debug('Checking usersVideoRating parameters', { parameters: req.params })

    if (areValidationErrors(req, res)) return
    if (!await isVideoExist(req.params.videoId, res)) return

    return next()
  }
]

const ensureUserRegistrationAllowed = [
  async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const allowed = await isSignupAllowed()
    if (allowed === false) {
      return res.status(403)
                .send({ error: 'User registration is not enabled or user limit is reached.' })
                .end()
    }

    return next()
  }
]

const usersAskResetPasswordValidator = [
  body('email').isEmail().not().isEmpty().withMessage('Should have a valid email'),

  async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    logger.debug('Checking usersAskResetPassword parameters', { parameters: req.body })

    if (areValidationErrors(req, res)) return
    const exists = await checkUserEmailExist(req.body.email, res, false)
    if (!exists) {
      logger.debug('User with email %s does not exist (asking reset password).', req.body.email)
      // Do not leak our emails
      return res.status(204).end()
    }

    return next()
  }
]

const usersResetPasswordValidator = [
  param('id').isInt().not().isEmpty().withMessage('Should have a valid id'),
  body('verificationString').not().isEmpty().withMessage('Should have a valid verification string'),
  body('password').custom(isUserPasswordValid).withMessage('Should have a valid password'),

  async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    logger.debug('Checking usersResetPassword parameters', { parameters: req.params })

    if (areValidationErrors(req, res)) return
    if (!await checkUserIdExist(req.params.id, res)) return

    const user = res.locals.user as UserModel
    const redisVerificationString = await Redis.Instance.getResetPasswordLink(user.id)

    if (redisVerificationString !== req.body.verificationString) {
      return res
        .status(403)
        .send({ error: 'Invalid verification string.' })
        .end
    }

    return next()
  }
]

// ---------------------------------------------------------------------------

export {
  usersAddValidator,
  usersRegisterValidator,
  usersRemoveValidator,
  usersUpdateValidator,
  usersUpdateMeValidator,
  usersVideoRatingValidator,
  ensureUserRegistrationAllowed,
  usersGetValidator,
  usersUpdateMyAvatarValidator,
  usersAskResetPasswordValidator,
  usersResetPasswordValidator
}

// ---------------------------------------------------------------------------

function checkUserIdExist (id: number, res: express.Response) {
  return checkUserExist(() => UserModel.loadById(id), res)
}

function checkUserEmailExist (email: string, res: express.Response, abortResponse = true) {
  return checkUserExist(() => UserModel.loadByEmail(email), res, abortResponse)
}

async function checkUserNameOrEmailDoesNotAlreadyExist (username: string, email: string, res: express.Response) {
  const user = await UserModel.loadByUsernameOrEmail(username, email)

  if (user) {
    res.status(409)
              .send({ error: 'User with this username of email already exists.' })
              .end()
    return false
  }

  return true
}

async function checkUserExist (finder: () => Bluebird<UserModel>, res: express.Response, abortResponse = true) {
  const user = await finder()

  if (!user) {
    if (abortResponse === true) {
      res.status(404)
        .send({ error: 'User not found' })
        .end()
    }

    return false
  }

  res.locals.user = user

  return true
}
