# gcal-scheduler

```bash
npm install --production

zip -r gcal-scheduler.zip . -x '*.git*' -x '.DS_Store'

aws lambda update-function-code --function-name $FUNCTION_NAME --zip-file fileb://gcal-scheduler.zip
```
