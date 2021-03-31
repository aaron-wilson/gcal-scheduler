const jwt = require('jsonwebtoken');
const fetch = require('node-fetch');
require('dotenv').config();

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
 * @return {Promise}
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
  return response;
}

/**
 * @return {Promise}
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
  return response;
}

/**
 * @return {string}
 */
function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0; const v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
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
  const messageJson = JSON.parse(message);
  const {
    startDt,
    endDt,
  } = getDts(messageJson.sReceivedTimestamp, WINDOW_LENGTH_HOURS);

  const assertion = generateAssertion();
  return getToken(assertion)
      .then((response) => response.text())
      .then((tokenBody) => {
        console.log(tokenBody);

        const token = (JSON.parse(tokenBody)).access_token;
        endDt.setHours(startDt.getHours() + 2);

        const summary = messageJson.sCustomerName;
        const description = messageJson.sCustomerEmail +
                            '\n' +
                            messageJson.sCustomerNumber +
                            '\n' +
                            '\n' +
                            uuidv4();

        return createEvent(summary, description, startDt, endDt, token)
            .then((response) => response.text())
            .then((eventBody) => console.log(eventBody))
            .catch((error) => console.log(error));
      })
      .catch((error) => console.log(error));
};
