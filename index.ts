import axios from 'axios';
import moment from 'moment';
import { URL } from 'url';
import dotenv from 'dotenv';
import cron, {ScheduledTask} from 'node-cron';

dotenv.config();

export async function fetchAvailabilities(): Promise<string[]> {
  try {
    // Get the URL from the environment variable
    let url = process.env.APPOINTMENT_URL || '';

    // Check if the URL is defined
    if (!url) {
      throw new Error('The APPOINTMENT_URL environment variable is not defined.');
    }

    // Replace the start_date with today's date
    const today = moment().format('YYYY-MM-DD');
    url = url.replace(/start_date=\d{4}-\d{2}-\d{2}/, `start_date=${today}`);

    // Check if the URL is valid
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch (error) {
      throw new Error('The APPOINTMENT_URL environment variable is not a valid URL.');
    }

    console.log(`Fetching availabilities for ${url}`);

    // Fetch the availabilities.json
    const response = await axios.get<{next_slot: string}>(parsedUrl.toString());

    // Check if next_slot is available
    const nextSlot = response.data.next_slot;

    if (nextSlot) {
      const availableDates = [moment(nextSlot).format('YYYY-MM-DD')];
      console.log('Fetch complete.');
      return availableDates;
    } else {
      console.log('No next_slot available.');
      return [];
    }
  } catch (error) {
    console.error(`Error fetching availabilities: ${error}`);
    return [];
  }
}

export async function availableAppointment(dates: string[], timespan: number): Promise<string> {
  // Check if the timespan is a valid number
  if (isNaN(timespan)) {
    throw new Error('The TIMESPAN_DAYS environment variable is not a valid number.');
  }

  console.log('Checking for available appointments...');

  // Get the current date and the date after the given timespan
  const now = moment();
  const futureDate = moment().add(timespan, 'days');

  // Sort the dates array
  dates.sort();

  // Check if there's a date within the timespan
  for (const date of dates) {
    const appointmentDate = moment(date);
    if (appointmentDate.isBetween(now, futureDate, 'day', '[]')) {
      console.log(`Found an available appointment on ${date}.`);
      return date;
    }
  }

  console.log('No available appointments found.');

  return '';
}

export async function sendTelegramNotification(date: string): Promise<void> {
  const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
  const telegramChatId = process.env.TELEGRAM_CHAT_ID;
  const bookingUrl = process.env.DOCTOR_BOOKING_URL;

  if (!telegramBotToken) {
    throw new Error('The TELEGRAM_BOT_TOKEN environment variable is not defined.');
  }

  if (!telegramChatId) {
    throw new Error('The TELEGRAM_CHAT_ID environment variable is not defined.');
  }

  if (!bookingUrl) {
    throw new Error('The DOCTOR_BOOKING_URL environment variable is not defined.');
  }

  // Убедимся, что Chat ID - число
  const chatId = parseInt(telegramChatId);
  if (isNaN(chatId)) {
    throw new Error('The TELEGRAM_CHAT_ID must be a valid number.');
  }

  // Простое сообщение без Markdown разметки
  const message = `💊 Доступна запись на ${date} 📅\n\nЗабронируйте здесь: ${bookingUrl}`;

  const url = `https://api.telegram.org/bot${telegramBotToken}/sendMessage`;

  try {
    const response = await axios.post(url, {
      chat_id: chatId,
      text: message
      // Убрали parse_mode: 'Markdown'
    });
    
    if (response.data.ok) {
      console.log('Telegram notification sent successfully.');
    } else {
      throw new Error(`Telegram API error: ${response.data.description}`);
    }
  } catch (error: any) {
    console.error(`Error sending Telegram notification: ${error.response?.data?.description || error.message}`);
    throw error;
  }
}

export async function sendInitialTelegramNotification(): Promise<void> {
  const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
  const telegramChatId = process.env.TELEGRAM_CHAT_ID;
  const bookingUrl = process.env.DOCTOR_BOOKING_URL;
  const timespan = Number(process.env.TIMESPAN_DAYS || '0');
  const schedule = process.env.SCHEDULE || '* * * * *';

  if (!telegramBotToken) {
    console.error('The TELEGRAM_BOT_TOKEN environment variable is not defined.');
    return;
  }

  if (!telegramChatId) {
    console.error('The TELEGRAM_CHAT_ID environment variable is not defined.');
    return;
  }

  if (!bookingUrl) {
    console.error('The DOCTOR_BOOKING_URL environment variable is not defined.');
    return;
  }

  // Убедимся, что Chat ID - число
  const chatId = parseInt(telegramChatId);
  if (isNaN(chatId)) {
    console.error('The TELEGRAM_CHAT_ID must be a valid number.');
    return;
  }

  // Простое сообщение без Markdown разметки
  const message = `🤖 Doctolib Appointment Finder запущен!\n\nПроверка расписания: ${schedule}\nПериод поиска: ${timespan} дней\nСсылка для бронирования: ${bookingUrl}\n\nВы будете получать уведомления, когда появятся доступные записи.`;

  const url = `https://api.telegram.org/bot${telegramBotToken}/sendMessage`;

  try {
    const response = await axios.post(url, {
      chat_id: chatId,
      text: message
      // Убрали parse_mode: 'Markdown'
    });
    
    if (response.data.ok) {
      console.log('Initial Telegram notification sent successfully.');
    } else {
      console.error(`Telegram API error: ${response.data.description}`);
    }
  } catch (error: any) {
    console.error(`Error sending initial Telegram notification: ${error.response?.data?.description || error.message}`);
  }
}

// Usage
let task: ScheduledTask;

async function checkAppointmentAvailability() {
  // Get the timespan from the environment variable
  const timespan = Number(process.env.TIMESPAN_DAYS || '0');
  const stopWhenFound = process.env.STOP_WHEN_FOUND?.toLowerCase() === 'true'

  try {
    const dates = await fetchAvailabilities();
    const date = await availableAppointment(dates, timespan);

    if (date) {
      console.log(`Next available appointment is on: ${date}`);
      await sendTelegramNotification(date).catch((error) => {
        console.error(`Error while sending Telegram notification: ${error}`);
      });

      // Stop the task once an appointment is found
      if (task && stopWhenFound) {
        console.log('Appointment found. Stopping the task...');
        task.stop();
      }
    } else {
      console.log(`No appointments available within the specified timespan (${timespan} days).`);
    }
  } catch (error) {
    console.error(`Error while checking appointment availability: ${error}`);
  }
}

if (typeof jest !== 'undefined') {
  console.log('Running in Jest environment');
} else {
  // Get the schedule from the environment variable
  const schedule = process.env.SCHEDULE || '* * * * *';

  // Schedule the function using node-cron
  if (!cron.validate(schedule)) {
    console.error('The SCHEDULE environment variable is not a valid cron expression.');
  } else {
    console.log(`Scheduling appointment availability check every ${schedule}.`);
    try {
      task = cron.schedule(schedule, checkAppointmentAvailability);

      // Добавим небольшую задержку перед отправкой начального уведомления
      setTimeout(() => {
        sendInitialTelegramNotification().catch((error) => {
          console.error(`Error while sending initial Telegram notification: ${error}`);
        });
      }, 2000);

    } catch (error) {
      console.error(`Error while scheduling appointment availability check: ${error}`);
    }
  }
}