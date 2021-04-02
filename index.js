require('dotenv').config();

const jwt = require('jsonwebtoken');
const fetch = require('node-fetch');
const AWS = require('aws-sdk');

const email = require('./email');

/**
 * @return {string}
 */
function uuid4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0; const v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * @return {string}
 */
function generateFormBody(object) {
  const formBody = [];
  for (const property in object) {
    const encodedKey = encodeURIComponent(property);
    const encodedValue = encodeURIComponent(object[property]);
    formBody.push(encodedKey + '=' + encodedValue);
  }
  return formBody.join('&');
}

/**
 * @return {Object}
 */
function getDts(receivedTimestamp, windowLengthHours) {
  const utcDate = new Date(receivedTimestamp);
  const etDateTimeSplit = utcDate.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    hour12: false,
  }).split(', ');

  const etDateString = etDateTimeSplit[0];
  const etDateStringSplit = etDateString.split('/');
  const etYear = etDateStringSplit[2];
  let etMonth = etDateStringSplit[0];
  if (etMonth.toString().length == 1) etMonth = `0${etMonth}`;
  let etDay = etDateStringSplit[1];
  if (etDay.toString().length == 1) etDay = `0${etDay}`;

  const etHours = etDateTimeSplit[1].split(':')[0];

  let offsetHours;
  if (utcDate.getUTCHours() < parseInt(etHours)) {
    offsetHours = parseInt(etHours) - (utcDate.getUTCHours() + 24);
  } else {
    offsetHours = parseInt(etHours) - utcDate.getUTCHours();
  }

  let offsetHoursString;
  if (offsetHours < 0) {
    if (offsetHours.toString().length == 2) {
      offsetHoursString = `-0${Math.abs(offsetHours)}`;
    } else {
      offsetHoursString = offsetHours.toString();
    }
  } else {
    if (offsetHours.toString().length == 1) {
      offsetHoursString = `+0${offsetHours}`;
    } else {
      offsetHoursString = `+${offsetHours}`;
    }
  }

  let startDt; let isoString;
  if (0 <= etHours && etHours <= 8) {
    // 0900 delivery window following day
    isoString = `${etYear}-${etMonth}-${etDay}T09:00:00${offsetHoursString}:00`;
    startDt = new Date(isoString);
    startDt.setHours(startDt.getHours() + 24);
  } else if (9 <= etHours && etHours <= 16) {
    // +24 Hours
    isoString = `${etYear}-${etMonth}-${etDay}T${etHours}:00:00${offsetHoursString}:00`;
    startDt = new Date(isoString);
    startDt.setHours(startDt.getHours() + 24);
  } else if (17 <= etHours && etHours <= 20) {
    // 1600 delivery window following day
    isoString = `${etYear}-${etMonth}-${etDay}T16:00:00${offsetHoursString}:00`;
    startDt = new Date(isoString);
    startDt.setHours(startDt.getHours() + 24);
  } else if (21 <= etHours && etHours <= 23) {
    // 0900 delivery window +2 days later
    isoString = `${etYear}-${etMonth}-${etDay}T09:00:00${offsetHoursString}:00`;
    startDt = new Date(isoString);
    startDt.setHours(startDt.getHours() + 48);
  }
  const endDt = new Date(startDt.getTime());
  endDt.setHours(startDt.getHours() + windowLengthHours);

  console.log({isoString});

  return {startDt, endDt};
}

/**
 * @return {string}
 */
function generateReplacementText(startDt, endDt) {
  const dateString = startDt.toLocaleDateString('en-US', {timeZone: 'America/New_York'});
  const startTimeString = startDt
      .toLocaleTimeString('en-US', {timeZone: 'America/New_York'})
      .replace(':00:00', '');
  const endTimeString = endDt
      .toLocaleTimeString('en-US', {timeZone: 'America/New_York'})
      .replace(':00:00', '');

  return `${startTimeString} and ${endTimeString} on ${dateString}`;
}

/**
 * @return {string}
 */
function generateAssertion() {
  return jwt.sign({
    'iss': process.env.SERVICE_ACCOUNT,
    'sub': process.env.SERVICE_ACCOUNT,
    'aud': 'https://www.googleapis.com/oauth2/v4/token',
    'scope': 'https://www.googleapis.com/auth/calendar',
  },
  process.env.PRIVATE_KEY.replace(/\\n/g, '\n'),
  {
    expiresIn: 60 * 59,
    header: {
      'alg': 'RS256',
      'typ': 'JWT',
      'kid': process.env.KID,
    },
  });
}

/**
 * @return {string}
 */
async function getToken(assertion) {
  const response = await fetch('https://www.googleapis.com/oauth2/v4/token', {
    method: 'POST',
    headers: {'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'},
    body: generateFormBody({
      'grant_type': 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  const responseObj = await response.json();
  console.log({responseObj});

  return responseObj.access_token;
}

/**
 * @return {Object}
 */
async function createEvent(summary, description, startDt, endDt, token) {
  const requestBody = {
    summary,
    description,
    'start': {
      'dateTime': startDt.toISOString(),
      'timeZone': 'America/New_York',
    },
    'end': {
      'dateTime': endDt.toISOString(),
      'timeZone': 'America/New_York',
    },
  };
  console.log({requestBody});

  const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${process.env.CALENDAR_ID}/events`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json;charset=UTF-8',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(requestBody),
  });
  const responseObj = await response.json();
  console.log({responseObj});

  return responseObj;
}

/**
 * @return {Promise}
 */
function snsPublish(message, topicArn) {
  // Create publish parameters
  const params = {
    Message: message,
    TopicArn: topicArn,
  };
  console.log({params});

  // Create promise and SNS service object
  const publishTextPromise = new AWS
      .SNS({apiVersion: '2010-03-31'})
      .publish(params)
      .promise();

  console.log({message: 'publishing to SNS'});
  return publishTextPromise;
}

/**
 * @return {Promise}
 */
function sesEmail(fromEmail, toEmail, bccEmail, subject, htmlBody) {
  // Create sendEmail params
  const params = {
    Destination: {
      BccAddresses: [
        bccEmail,
      ],
      ToAddresses: [
        toEmail,
      ],
    },
    Message: {
      Body: {
        Html: {
          Charset: 'UTF-8',
          Data: htmlBody,
        },
      },
      Subject: {
        Charset: 'UTF-8',
        Data: subject,
      },
    },
    Source: fromEmail,
  };

  // Create the promise and SES service object
  const sendPromise = new AWS.SES({apiVersion: '2010-12-01'}).sendEmail(params).promise();

  console.log({message: 'sending email'});
  return sendPromise;
}

exports.handler = async (event) => {
  console.log({event: JSON.stringify(event)});

  const WINDOW_LENGTH_HOURS = 2;

  // {
  //   "sReceivedTimestamp": "Tue, 30 Mar 2021 12:25:05 +0000",
  //   "sCustomerName": "First Last",
  //   "sCustomerEmail": "first.last@example.com",
  //   "sCustomerNumber": "+1 (555) 555-5555"
  // }
  const message = event['Records'][0]['Sns']['Message'];
  console.log({message});
  const messageObj = JSON.parse(message);

  const {
    startDt,
    endDt,
  } = getDts(messageObj.sReceivedTimestamp, WINDOW_LENGTH_HOURS);
  const summary = messageObj.sCustomerName;
  const description = messageObj.sCustomerEmail +
                      '\n' +
                      messageObj.sCustomerNumber +
                      '\n' +
                      '\n' +
                      uuid4();
  const snsMessage = process.env.SNS_PUBLISH_MESSAGE;
  const snsTopicArn = process.env.SNS_PUBLISH_TOPIC_ARN;
  const fromEmail = process.env.FROM_EMAIL;
  const toEmail = messageObj.sCustomerEmail;
  const bccEmail = process.env.BCC_EMAIL;
  const subject = process.env.SUBJECT;
  const htmlBody = email
      .htmlBody
      .replace('$$replace$$', generateReplacementText(startDt, endDt));

  try {
    const assertion = generateAssertion();
    const token = await getToken(assertion);
    await createEvent(summary, description, startDt, endDt, token);
    await snsPublish(snsMessage, snsTopicArn);
    await sesEmail(fromEmail, toEmail, bccEmail, subject, htmlBody);
  } catch (err) {
    console.error({err});
  }
};
