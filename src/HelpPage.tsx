import { PlaySquare } from 'lucide-react';
import './tutorial.css';

const tutorialVideoId = '5wFzEnEWg_s';
const tutorialEmbed = `https://www.youtube.com/embed/${tutorialVideoId}?playsinline=1`;
const tutorialWatch = `https://www.youtube.com/watch?v=${tutorialVideoId}`;

const tourChapters = [
  { time: '0:03', title: 'Overview', description: 'আজকের বিক্রি, লাভ, খরচ ও কম স্টকের সতর্কতা দেখো।' },
  { time: '0:08', title: 'Products & stock', description: 'পণ্য খুঁজে দাম, মজুত ও স্টকের অবস্থা দেখো।' },
  { time: '0:13', title: 'Add product', description: 'নাম, ক্যাটাগরি, দাম ও শুরুর স্টক দিয়ে নতুন পণ্য যোগ করো।' },
  { time: '0:18', title: 'Add purchase', description: 'পণ্য, পরিমাণ ও একক দাম দিয়ে কেনাকাটা রেকর্ড করো।' },
  { time: '0:23', title: 'New sale', description: 'পণ্য বেছে পরিমাণ, গ্রাহক ও পেমেন্টের তথ্য দিয়ে বিক্রি নিশ্চিত করো।' },
  { time: '0:28', title: 'Record expense', description: 'খরচের বিবরণ, পরিমাণ ও তারিখ দিয়ে খরচ রেকর্ড করো।' },
  { time: '0:32', title: 'Reports & PDFs', description: 'রিপোর্টের ধরন ও তারিখ বেছে PDF ডাউনলোড করো।' },
  { time: '0:37', title: 'Customers', description: 'গ্রাহক খুঁজে বাকি টাকা, কেনাকাটার ইতিহাস ও পেমেন্ট দেখো।' },
  { time: '0:42', title: 'Staff access', description: 'দোকানের মালিক হিসেবে নিবন্ধিত অ্যাকাউন্টে স্টাফের অনুমতি দাও বা সরাও।' },
  { time: '0:47', title: 'Shop products', description: 'নাম বা ক্যাটাগরি দিয়ে দোকানের পণ্য খুঁজে দাম ও স্টক দেখো।' },
  { time: '0:52', title: 'Reviews & comments', description: 'পণ্যের রিভিউ পড়ো এবং সাইন ইন করে রিভিউ বা মন্তব্য যোগ করো।' },
  { time: '0:57', title: 'Visit our shop', description: 'দোকানের ঠিকানা, খোলার সময় ও ম্যাপ দেখো।' },
];

export function HelpPage() {
  return <section className="panel tutorial-panel" aria-labelledby="tutorial-title">
    <div className="tutorial-heading">
      <span className="tutorial-icon"><PlaySquare size={22} aria-hidden="true" /></span>
      <div>
        <h2 id="tutorial-title">SmartShop quick tour</h2>
        <p lang="bn">SmartShop-এর বর্তমান স্ক্রিনে পণ্য, স্টক, বিক্রি, গ্রাহক ও রিপোর্টের ব্যবহার দেখো।</p>
      </div>
    </div>
    <iframe className="tutorial-video" title="SmartShop quick tour on YouTube" src={tutorialEmbed}
      referrerPolicy="strict-origin-when-cross-origin" allow="encrypted-media; picture-in-picture" allowFullScreen />
    <details className="tutorial-steps" lang="bn">
      <summary>ভিডিওর বিষয় ও সময়</summary>
      <ol>
        {tourChapters.map(({ time, title, description }) => <li key={time}>
          <strong lang="en">{time} {title}</strong> — {description}
        </li>)}
      </ol>
    </details>
    <a className="tutorial-watch-link" href={tutorialWatch} target="_blank" rel="noopener">Watch on YouTube</a>
  </section>;
}
